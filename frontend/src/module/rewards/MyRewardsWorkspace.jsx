import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Building2, CalendarDays, CircleCheck, Crown, Download, RefreshCw, ScrollText, Trophy, UserX } from "lucide-react";
import { toast } from "react-hot-toast";
import { useAutoRefreshOnChange } from "../../components/auto/autorefreshdatalist";
import { fetchCertificateTemplate, fetchMyAwardCertificates } from "../../services/api";
import AwardCertificateModal, {
  AwardCertificatePaper,
  certificateFileName,
  exportCertificatePdf,
} from "./AwardCertificate";
import { createCertificateTemplate, normalizeCertificateTemplate } from "./certificateTemplate";
import { CardSkeleton, PortalButton, PortalEmptyState, StatCard } from "./NominationPortalUI";
import { formatCycleMonth, formatDate, parseMoment } from "./awardCycleUtils";

/**
 * My Rewards — the awards the signed-in person has won, each with its certificate.
 *
 * A certificate is minted when a nomination cycle closes with this person leading the employees'
 * vote, so the list only ever grows by the server's hand: nothing here files or edits anything.
 * The server scopes the list to the employee record behind the session, so it cannot be pointed at
 * somebody else's awards.
 *
 * Shown on its own under the Employee sidebar, and `embedded` inside the Nomination screen's
 * My Rewards view, where that screen already carries the heading.
 */
export default function MyRewardsWorkspace({ embedded = false }) {
  const [certificates, setCertificates] = useState([]);
  const [linked, setLinked] = useState(true);
  const [loading, setLoading] = useState(true);
  const [template, setTemplate] = useState(() => createCertificateTemplate());
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewCertificate, setPreviewCertificate] = useState(null);
  const [downloadingId, setDownloadingId] = useState("");
  /*
   * A card's Download has no certificate on screen to capture, so the paper is mounted off-screen
   * for the length of the export. The preview hands over its own node and skips this entirely.
   */
  const [downloadTarget, setDownloadTarget] = useState(null);
  const hiddenPaperRef = useRef(null);

  const loadCertificates = useCallback(async () => {
    // The template only styles the certificate, so failing to load it must not hide the awards.
    const loadTemplate = async () => {
      try {
        return await fetchCertificateTemplate();
      } catch {
        return null;
      }
    };

    try {
      const [result, templateResult] = await Promise.all([fetchMyAwardCertificates(), loadTemplate()]);

      setCertificates(Array.isArray(result?.certificates) ? result.certificates : []);
      setLinked(result?.linked !== false);
      if (templateResult?.template) {
        setTemplate(normalizeCertificateTemplate(templateResult.template));
      }
    } catch {
      setCertificates([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCertificates();
  }, [loadCertificates]);

  // Closing a cycle mints the certificate, so a win that lands while the page is open appears without a reload.
  useAutoRefreshOnChange(loadCertificates, { topic: "rewards", refreshOnMount: false });

  const runDownload = useCallback(async (node, certificate) => {
    setDownloadingId(String(certificate?.id ?? ""));

    try {
      await exportCertificatePdf(node, certificateFileName(certificate));
      toast.success("Certificate downloaded.");
    } catch {
      toast.error("Unable to download the certificate.");
    } finally {
      setDownloadingId("");
    }
  }, []);

  /*
   * Waits one frame so the off-screen paper is laid out before it is captured; the export itself
   * waits on the letterhead images, so nothing else here needs to.
   */
  useEffect(() => {
    if (!downloadTarget) {
      return undefined;
    }

    let cancelled = false;
    const frame = window.requestAnimationFrame(() => {
      void runDownload(hiddenPaperRef.current, downloadTarget).finally(() => {
        if (!cancelled) {
          setDownloadTarget(null);
        }
      });
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [downloadTarget, runDownload]);

  const stats = useMemo(() => {
    const year = new Date().getFullYear();

    return [
      { label: "Awards won", value: certificates.length, icon: Trophy, accent: "primary" },
      {
        label: "Won this year",
        value: certificates.filter((certificate) => parseMoment(certificate.awardedOn)?.getFullYear() === year).length,
        icon: CalendarDays,
        accent: "emerald",
      },
      {
        // The count each award was won with: employee votes (approved nominations for an award decided before the vote).
        label: "Votes received",
        value: certificates.reduce((sum, certificate) => sum + Number(certificate.votes || 0), 0),
        icon: CircleCheck,
        accent: "amber",
      },
    ];
  }, [certificates]);

  const certificateTemplateFor = (certificate) => normalizeCertificateTemplate(certificate?.template || template);

  return (
    <div className="w-full space-y-6">
      {embedded ? null : (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="m-0 text-lg font-semibold tracking-tight text-slate-950">My Rewards</h2>
            <p className="m-0 text-sm text-slate-500">
              Awards you have won through Rewards &amp; Recognition. A certificate is issued automatically when a
              nomination cycle you won closes.
            </p>
          </div>
          <PortalButton size="sm" variant="ghost" onClick={() => void loadCertificates()}>
            <RefreshCw size={16} aria-hidden="true" />
            Refresh
          </PortalButton>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {stats.map((stat) => (
          <StatCard key={stat.label} {...stat} />
        ))}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <CardSkeleton className="h-52 w-full" />
          <CardSkeleton className="h-52 w-full" />
        </div>
      ) : !linked ? (
        <PortalEmptyState
          icon={UserX}
          title="We cannot tell which employee you are"
          description="Your account is not linked to an employee record, so awards cannot be matched to you. Ask HR to check it."
        />
      ) : certificates.length === 0 ? (
        <PortalEmptyState
          icon={Trophy}
          title="No rewards yet"
          description="Keep up the great work — when you win a nomination cycle, your award and its certificate will appear here."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {certificates.map((certificate) => {
            const month = formatCycleMonth(certificate.opensOn);
            const downloading = downloadingId === String(certificate.id);

            return (
              <article
                key={certificate.id}
                className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md"
              >
                <div className="h-1.5 w-full bg-gradient-to-r from-amber-400 to-amber-600" aria-hidden="true" />
                <div className="flex flex-1 flex-col gap-4 p-5">
                  <div className="flex items-start gap-3">
                    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-700 ring-2 ring-amber-500/20">
                      <Crown size={20} aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="m-0 text-base font-semibold leading-tight text-slate-950">{certificate.awardTitle}</h3>
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white shadow-sm">
                          <Crown size={12} aria-hidden="true" />
                          1st Place
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-slate-500">
                        <CalendarDays size={14} aria-hidden="true" />
                        {month ? <span>{month}</span> : null}
                        {month ? <span className="text-slate-300" aria-hidden="true">·</span> : null}
                        <span>Awarded {formatDate(certificate.awardedOn) || "—"}</span>
                      </div>
                    </div>
                  </div>

                  <dl className="m-0 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <div className="rounded-lg bg-slate-100/80 p-2.5">
                      <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Certificate No.</dt>
                      <dd className="m-0 mt-0.5 truncate text-sm font-bold text-slate-900">{certificate.certificateNumber || "—"}</dd>
                    </div>
                    <div className="rounded-lg bg-emerald-50 p-2.5 text-emerald-700">
                      <dt className="text-[10px] font-semibold uppercase tracking-wide opacity-80">Votes</dt>
                      <dd className="m-0 mt-0.5 text-sm font-bold">{certificate.votes}</dd>
                    </div>
                    <div className="col-span-2 rounded-lg bg-slate-100/80 p-2.5 sm:col-span-1">
                      <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Division</dt>
                      <dd className="m-0 mt-0.5 flex items-center gap-1 truncate text-sm font-bold text-slate-900">
                        <Building2 size={12} className="shrink-0" aria-hidden="true" />
                        <span className="truncate">{certificate.divisionName || "—"}</span>
                      </dd>
                    </div>
                  </dl>

                  <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
                    <PortalButton
                      size="sm"
                      onClick={() => {
                        setPreviewCertificate(certificate);
                        setPreviewOpen(true);
                      }}
                      aria-label={`View the certificate for ${certificate.awardTitle}`}
                    >
                      <ScrollText size={16} aria-hidden="true" />
                      View certificate
                    </PortalButton>
                    <PortalButton
                      size="sm"
                      variant="outline"
                      disabled={downloadingId !== ""}
                      onClick={() => setDownloadTarget(certificate)}
                      aria-label={`Download the certificate for ${certificate.awardTitle}`}
                    >
                      <Download size={16} aria-hidden="true" />
                      {downloading ? "Saving..." : "Download PDF"}
                    </PortalButton>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <AwardCertificateModal
        open={previewOpen}
        certificate={previewCertificate}
        template={certificateTemplateFor(previewCertificate)}
        downloading={downloadingId === String(previewCertificate?.id ?? "")}
        onDownload={(node) => runDownload(node, previewCertificate)}
        onClose={() => setPreviewOpen(false)}
      />

      {/*
        Off-screen rather than hidden: html2canvas paints what the browser laid out, and a
        `display: none` paper has no layout to paint.
      */}
      {downloadTarget ? (
        <div
          aria-hidden="true"
          style={{ position: "fixed", top: 0, left: "-10000px", width: "960px", pointerEvents: "none" }}
        >
          <AwardCertificatePaper
            ref={hiddenPaperRef}
            certificate={downloadTarget}
            template={certificateTemplateFor(downloadTarget)}
          />
        </div>
      ) : null}
    </div>
  );
}
