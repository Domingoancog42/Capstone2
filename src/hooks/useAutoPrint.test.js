import React, { useEffect } from "react";
import { act, render, waitFor } from "@testing-library/react";
import useAutoPrint from "./useAutoPrint";

/*
 * The printed sheet is a clone of the form on screen, so printing before the signature lookups land
 * would send an unsigned government form to the printer. These cover the ordering the modals rely
 * on: the print waits for every tracked load, fires once, and never fires for a reader who opened
 * the form to look at it.
 */
describe("useAutoPrint", () => {
  const flushFrames = async () => {
    await act(async () => {
      await new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
      await new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
    });
  };

  /* Stands in for a modal: the loads start in effects, exactly as the real signature loads do. */
  function PrintableForm({ active, loads = [], onPrint, onDone }) {
    const trackLoad = useAutoPrint({ active, onPrint, onDone });

    useEffect(() => {
      loads.forEach((load) => {
        void trackLoad(load);
      });
      // The loads are fixed per mount, like the modal's one effect per signature.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [trackLoad]);

    return null;
  }

  it("waits for every tracked load before printing", async () => {
    const onPrint = jest.fn();
    let releaseSignature;
    const signature = new Promise((resolve) => {
      releaseSignature = resolve;
    });

    render(
      <PrintableForm active loads={[() => signature]} onPrint={onPrint} />
    );

    await flushFrames();
    expect(onPrint).not.toHaveBeenCalled();

    await act(async () => {
      releaseSignature();
      await signature;
    });
    await flushFrames();

    expect(onPrint).toHaveBeenCalledTimes(1);
  });

  it("prints once and reports back when there is nothing to load", async () => {
    const onPrint = jest.fn();
    const onDone = jest.fn();

    render(<PrintableForm active onPrint={onPrint} onDone={onDone} />);
    await flushFrames();
    await flushFrames();

    expect(onPrint).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("stays out of the way when the form was opened to be read", async () => {
    const onPrint = jest.fn();

    render(
      <PrintableForm active={false} loads={[async () => "signature"]} onPrint={onPrint} />
    );
    await flushFrames();

    expect(onPrint).not.toHaveBeenCalled();
  });
});
