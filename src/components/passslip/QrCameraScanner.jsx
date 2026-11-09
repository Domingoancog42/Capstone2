import React, { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { CameraOff, Loader2, RefreshCw } from "lucide-react";

/*
 * Camera QR reader.
 *
 * Decoding is done in the page with jsQR rather than through the browser's BarcodeDetector: that API
 * is still absent from desktop Firefox and from Chrome on Windows, which is precisely the machine a
 * pass slip desk runs on. jsQR is a few tens of kilobytes and works anywhere a canvas does.
 *
 * The camera is not the only way in, and on purpose. getUserMedia is refused outside a secure
 * context, so on an office LAN served over plain HTTP -- the normal deployment for this system --
 * there is no camera to offer at all. The console around this component always keeps a hardware
 * reader and a typed reference available; this is the convenience path, not the contract.
 */

/*
 * Decode attempts per second. A QR sits still in front of a lens, so there is nothing to gain from
 * reading every frame, and getImageData plus a decode is the expensive part -- at 60fps it pins a
 * core on the kind of machine that sits at a reception desk.
 */
const SCANS_PER_SECOND = 8;

/* 1x is the camera's normal field of view. Some phones remember a previous digital zoom setting,
 * so explicitly restore it whenever the track exposes zoom controls. If a camera only supports an
 * ultra-wide 0.5x value, clamping below will use that instead of asking for an unsupported value. */
const NORMAL_CAMERA_ZOOM = 1;

/* Full-frame passes are scaled down to this width, which is enough for a code held up close. */
const MAX_DECODE_WIDTH = 960;

/*
 * Every other pass decodes the centre of the frame at the camera's own resolution instead. Most desk
 * webcams are fixed-focus and go soft within ~20cm, so a code has to be held back far enough to stay
 * sharp -- and at that distance it is small in the frame. Halving the whole frame first would throw
 * away exactly the detail needed to read it. The crop is a little larger than the on-screen guide.
 */
const CENTRE_CROP_FRACTION = 0.75;
const MAX_CENTRE_DECODE_SIZE = 1024;

/* Where in the camera's sharpness range to sit: crisper module edges without the halos of the max. */
const SHARPNESS_LEVEL = 0.75;

/** Never leave the scanner on "Opening the camera..." when a browser/driver promise stalls. */
const CAMERA_START_TIMEOUT_MS = 12000;

/** Build only constraints the selected camera says it supports. Exported for focused unit tests. */
export function preferredCameraTrackConstraints(capabilities = {}) {
  /*
   * One advanced set per control. The browser discards a whole set when any part of it is refused, so
   * a driver that rejects sharpness must not also cost the scanner its autofocus.
   */
  const advanced = [];
  const zoomMinimum = Number(capabilities.zoom?.min);
  const zoomMaximum = Number(capabilities.zoom?.max);

  if (Number.isFinite(zoomMinimum) && Number.isFinite(zoomMaximum)) {
    advanced.push({ zoom: Math.min(zoomMaximum, Math.max(zoomMinimum, NORMAL_CAMERA_ZOOM)) });
  }

  if (Array.isArray(capabilities.focusMode) && capabilities.focusMode.includes("continuous")) {
    advanced.push({ focusMode: "continuous" });
  }

  const sharpnessMinimum = Number(capabilities.sharpness?.min);
  const sharpnessMaximum = Number(capabilities.sharpness?.max);

  if (Number.isFinite(sharpnessMinimum) && Number.isFinite(sharpnessMaximum) && sharpnessMaximum > sharpnessMinimum) {
    const step = Number(capabilities.sharpness.step) > 0 ? Number(capabilities.sharpness.step) : 1;
    const offset = (sharpnessMaximum - sharpnessMinimum) * SHARPNESS_LEVEL;
    advanced.push({ sharpness: sharpnessMinimum + Math.round(offset / step) * step });
  }

  return advanced.length > 0 ? { advanced } : null;
}

/**
 * The part of the frame to hand jsQR and the size to draw it at: either a native-resolution square
 * from the centre, or the whole frame scaled down. Exported for focused unit tests.
 */
export function decodeRegion(videoWidth, videoHeight, centreCrop) {
  if (!videoWidth || !videoHeight) {
    return null;
  }

  if (centreCrop) {
    const side = Math.round(Math.min(videoWidth, videoHeight) * CENTRE_CROP_FRACTION);
    const size = Math.min(side, MAX_CENTRE_DECODE_SIZE);

    return {
      sx: Math.round((videoWidth - side) / 2),
      sy: Math.round((videoHeight - side) / 2),
      sw: side,
      sh: side,
      width: size,
      height: size,
    };
  }

  const scale = Math.min(1, MAX_DECODE_WIDTH / videoWidth);

  return {
    sx: 0,
    sy: 0,
    sw: videoWidth,
    sh: videoHeight,
    width: Math.round(videoWidth * scale),
    height: Math.round(videoHeight * scale),
  };
}

async function tuneCameraTrack(track) {
  if (!track || typeof track.getCapabilities !== "function" || typeof track.applyConstraints !== "function") {
    return;
  }

  try {
    const constraints = preferredCameraTrackConstraints(track.getCapabilities());
    if (constraints) {
      await track.applyConstraints(constraints);
    }
  } catch {
    // A webcam may advertise a control that its driver then refuses. The live stream is still more
    // useful than failing the whole scanner, so keep it running with the camera's own settings.
  }
}

export function cameraScanningSupported() {
  return Boolean(
    typeof navigator !== "undefined"
      && navigator.mediaDevices
      && typeof navigator.mediaDevices.getUserMedia === "function"
  );
}

export default function QrCameraScanner({ active = false, onDecode, paused = false }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const frameRef = useRef(0);
  const lastDecodeRef = useRef(0);
  const decodePendingRef = useRef(false);
  const pausedRef = useRef(paused);
  const onDecodeRef = useRef(onDecode);

  const [status, setStatus] = useState("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [restartKey, setRestartKey] = useState(0);

  /*
   * Both read through refs so the decode loop never has to be torn down and restarted. Restarting it
   * on a prop change would restart the camera with it, and the stream takes a second to come back --
   * which is a second of black screen every time the console marks itself busy.
   */
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    onDecodeRef.current = onDecode;
  }, [onDecode]);

  const stopCamera = useCallback(() => {
    window.cancelAnimationFrame(frameRef.current);
    frameRef.current = 0;

    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  useEffect(() => {
    if (!active) {
      stopCamera();
      setStatus("idle");
      setErrorMessage("");
      return undefined;
    }

    if (!cameraScanningSupported()) {
      setStatus("unsupported");
      setErrorMessage(
        typeof window !== "undefined" && !window.isSecureContext
          ? "The browser only opens a camera over HTTPS or on localhost. Use a USB reader or type the reference instead."
          : "This browser does not offer camera access. Use a USB reader or type the reference instead."
      );
      return undefined;
    }

    let cancelled = false;
    let startupExpired = false;
    setStatus("starting");
    setErrorMessage("");
    stopCamera();

    const startupTimer = window.setTimeout(() => {
      if (cancelled) return;

      startupExpired = true;
      stopCamera();
      setStatus("error");
      setErrorMessage("The camera took too long to open. Close other camera apps, then try again.");
    }, CAMERA_START_TIMEOUT_MS);

    const finishStartup = () => window.clearTimeout(startupTimer);

    /* Alternates centre-crop and full-frame passes, so a code off to one side is still found. */
    let centrePass = false;

    const tick = () => {
      frameRef.current = window.requestAnimationFrame(tick);

      const video = videoRef.current;
      const canvas = canvasRef.current;

      if (pausedRef.current || !video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
        return;
      }

      const now = performance.now();
      if (now - lastDecodeRef.current < 1000 / SCANS_PER_SECOND) {
        return;
      }
      lastDecodeRef.current = now;

      centrePass = !centrePass;
      const region = decodeRegion(video.videoWidth, video.videoHeight, centrePass);

      if (!region || region.width === 0 || region.height === 0) {
        return;
      }

      const { width, height } = region;
      canvas.width = width;
      canvas.height = height;

      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(video, region.sx, region.sy, region.sw, region.sh, 0, 0, width, height);

      const { data } = context.getImageData(0, 0, width, height);
      /*
       * "dontInvert": a pass slip code is always dark-on-light, printed or on a phone screen. Letting
       * jsQR also try the inverted image doubles the work per frame to find codes that cannot occur.
       */
      const result = jsQR(data, width, height, { inversionAttempts: "dontInvert" });

      if (result?.data && !decodePendingRef.current) {
        /* Lock immediately, before React has time to pass `paused=true` back down. This makes the
         * first readable frame one scan and prevents the next camera frame from submitting it a
         * second time while the server is recording Time Out or Time Returned. */
        decodePendingRef.current = true;

        try {
          Promise.resolve(onDecodeRef.current?.(result.data)).finally(() => {
            decodePendingRef.current = false;
            lastDecodeRef.current = performance.now();
          });
        } catch {
          decodePendingRef.current = false;
        }
      }
    };

    navigator.mediaDevices
      .getUserMedia({
        /* The rear camera on anything that has two; ignored by a desk webcam, which has one. */
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          aspectRatio: { ideal: 16 / 9 },
          frameRate: { ideal: 30, max: 30 },
        },
        audio: false,
      })
      .then((stream) => {
        if (cancelled || startupExpired) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;

        const video = videoRef.current;

        if (!video) {
          finishStartup();
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        video.srcObject = stream;
        /* iOS Safari refuses to play an inline stream without both of these set on the element. */
        video.setAttribute("playsinline", "true");
        video.muted = true;

        video
          .play()
          .then(() => {
            finishStartup();

            if (!cancelled && !startupExpired) {
              setStatus("running");
              frameRef.current = window.requestAnimationFrame(tick);
              // Zoom/focus are optional enhancements. Some drivers leave applyConstraints pending
              // after a refresh, so camera visibility must never wait for this promise.
              void tuneCameraTrack(stream.getVideoTracks()[0]);
            }
          })
          .catch(() => {
            finishStartup();

            if (!cancelled && !startupExpired) {
              stopCamera();
              setStatus("error");
              setErrorMessage("The camera stream could not be started.");
            }
          });
      })
      .catch((error) => {
        finishStartup();
        if (cancelled || startupExpired) return;

        stopCamera();
        setStatus("error");
        setErrorMessage(
          error?.name === "NotAllowedError"
            ? "Camera access was blocked. Allow it in the browser's address bar, or use a USB reader."
            : error?.name === "NotFoundError"
              ? "No camera was found on this machine."
              : "The camera could not be opened."
        );
      });

    return () => {
      cancelled = true;
      finishStartup();
      stopCamera();
    };
  }, [active, restartKey, stopCamera]);

  if (!active) {
    return null;
  }

  return (
    <div className="relative aspect-square w-full overflow-hidden rounded-2xl border border-slate-800 bg-black shadow-inner ring-1 ring-slate-950/10">
      <video
        ref={videoRef}
        aria-label="Live QR camera preview"
        autoPlay
        className="block h-full w-full bg-black object-cover"
        disablePictureInPicture
        playsInline
        muted
      />
      <canvas ref={canvasRef} className="hidden" />

      {/* A framing guide, so the code is held where the decoder is actually looking. */}
      {status === "running" ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div
            className={`h-[52%] w-[52%] min-h-40 min-w-40 max-h-72 max-w-72 rounded-3xl border-4 shadow-[0_0_0_999px_rgba(2,6,23,0.16)] transition-colors ${
              paused ? "border-amber-300/90" : "border-teal-300/80"
            }`}
          />
          <span className="absolute bottom-3 rounded-full bg-slate-950/70 px-3 py-1 text-[11px] font-semibold text-white/90">
            Blurry? Hold the QR about 20–30 cm from the camera
          </span>
        </div>
      ) : null}

      {status !== "running" ? (
        <div className="absolute inset-0 grid place-items-center bg-slate-950/85 p-6 text-center">
          {status === "starting" ? (
            <p className="m-0 inline-flex items-center gap-2 text-sm font-semibold text-slate-200">
              <Loader2 size={16} className="animate-spin" />
              Opening the camera...
            </p>
          ) : (
            <div className="max-w-xs">
              <CameraOff size={22} className="mx-auto text-slate-400" />
              <p className="m-0 mt-2 text-sm text-slate-300">{errorMessage}</p>
              {status === "error" ? (
                <button
                  type="button"
                  onClick={() => setRestartKey((current) => current + 1)}
                  className="mx-auto mt-3 inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-slate-600 bg-slate-800 px-3 text-xs font-semibold text-white transition hover:bg-slate-700"
                >
                  <RefreshCw size={14} />
                  Try camera again
                </button>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
