import { useEffect } from "react";
import {
  DISALLOWED_TEXT_MESSAGE,
  getDisallowedTextMessage,
} from "../utils/unsafeTextValidation";

const VALIDATED_INPUT_TYPES = new Set(["email", "search", "tel", "text", "url"]);
const messageNodes = new WeakMap();
const previousAccessibilityState = new WeakMap();
let messageSequence = 0;

function isValidatedControl(control) {
  if (control instanceof HTMLTextAreaElement) {
    return !control.disabled && !control.readOnly;
  }

  return control instanceof HTMLInputElement
    && VALIDATED_INPUT_TYPES.has(control.type)
    && !control.disabled
    && !control.readOnly;
}

function findMessageHost(control) {
  const declaredHost = control.closest("[data-validation-field]");

  if (declaredHost) {
    return declaredHost;
  }

  const wrappingLabel = control.closest("label");

  if (wrappingLabel) {
    return wrappingLabel;
  }

  if (control.id) {
    const escapedId = typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape(control.id)
      : control.id.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
    const explicitLabel = document.querySelector(`label[for="${escapedId}"]`);
    const parent = control.parentElement;

    if (explicitLabel && parent?.contains(explicitLabel)) {
      return parent;
    }

    if (explicitLabel && parent?.parentElement?.contains(explicitLabel)) {
      return parent.parentElement;
    }
  }

  return control.parentElement;
}

function clearUnsafeTextError(control) {
  if (!control.hasAttribute("data-unsafe-text-invalid") && !messageNodes.has(control)) {
    return;
  }

  const messageNode = messageNodes.get(control);
  const previousState = previousAccessibilityState.get(control);

  messageNode?.remove();
  messageNodes.delete(control);

  control.setCustomValidity("");
  control.removeAttribute("data-unsafe-text-invalid");

  if (previousState) {
    if (previousState.ariaInvalid === null) {
      control.removeAttribute("aria-invalid");
    } else {
      control.setAttribute("aria-invalid", previousState.ariaInvalid);
    }

    if (previousState.ariaDescribedBy === null) {
      control.removeAttribute("aria-describedby");
    } else {
      control.setAttribute("aria-describedby", previousState.ariaDescribedBy);
    }
  }

  previousAccessibilityState.delete(control);
}

function showUnsafeTextError(control) {
  const host = findMessageHost(control);

  if (!host) {
    return;
  }

  let messageNode = messageNodes.get(control);

  if (!messageNode?.isConnected) {
    messageSequence += 1;
    messageNode = document.createElement("span");
    messageNode.id = `unsafe-text-message-${messageSequence}`;
    messageNode.className = "unsafe-text-validation-message";
    messageNode.dataset.unsafeTextMessage = "true";
    messageNode.setAttribute("role", "alert");
    messageNode.textContent = DISALLOWED_TEXT_MESSAGE;
    host.appendChild(messageNode);
    messageNodes.set(control, messageNode);
  }

  if (!previousAccessibilityState.has(control)) {
    previousAccessibilityState.set(control, {
      ariaInvalid: control.getAttribute("aria-invalid"),
      ariaDescribedBy: control.getAttribute("aria-describedby"),
    });
  }

  const describedBy = new Set(
    String(control.getAttribute("aria-describedby") || "")
      .split(/\s+/)
      .filter(Boolean)
  );
  describedBy.add(messageNode.id);

  control.setCustomValidity(DISALLOWED_TEXT_MESSAGE);
  control.setAttribute("aria-invalid", "true");
  control.setAttribute("aria-describedby", Array.from(describedBy).join(" "));
  control.setAttribute("data-unsafe-text-invalid", "true");
}

function validateControl(control) {
  if (!isValidatedControl(control)) {
    return true;
  }

  const message = getDisallowedTextMessage(control.value);

  if (!message) {
    clearUnsafeTextError(control);
    return true;
  }

  showUnsafeTextError(control);
  return false;
}

export default function useUnsafeTextValidation() {
  useEffect(() => {
    const handleControlEvent = (event) => {
      if (!isValidatedControl(event.target)) {
        return;
      }

      validateControl(event.target);

      // Controlled React fields may replace nearby error content during the same event. Re-check
      // after that render so the global message remains directly beneath the current control.
      window.requestAnimationFrame(() => {
        if (event.target.isConnected) {
          validateControl(event.target);
        }
      });
    };

    const handleSubmit = (event) => {
      const controls = Array.from(event.target.elements || []).filter(isValidatedControl);
      const firstInvalidControl = controls.find((control) => !validateControl(control));

      if (!firstInvalidControl) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      firstInvalidControl.focus();
    };

    document.addEventListener("input", handleControlEvent, true);
    document.addEventListener("change", handleControlEvent, true);
    document.addEventListener("blur", handleControlEvent, true);
    document.addEventListener("submit", handleSubmit, true);

    return () => {
      document.removeEventListener("input", handleControlEvent, true);
      document.removeEventListener("change", handleControlEvent, true);
      document.removeEventListener("blur", handleControlEvent, true);
      document.removeEventListener("submit", handleSubmit, true);
    };
  }, []);
}
