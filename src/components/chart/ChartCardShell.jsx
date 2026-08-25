import React from "react";
import Card, {
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../UI/card";

export default function ChartCardShell({
  title,
  description,
  datasets = [],
  activeDatasetId = "",
  onSelectDataset,
  children,
}) {
  return (
    <Card className="analytics-card-shell overflow-hidden border-slate-200/80 bg-white/95 shadow-sm transition duration-300 hover:shadow-[0_20px_45px_rgba(15,23,42,0.08)]">
      <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-2xl">
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>

        {datasets.length > 1 ? (
          <div className="flex flex-wrap gap-2">
            {datasets.map((dataset) => {
              const isActive = dataset.id === activeDatasetId;

              return (
                <button
                  key={dataset.id}
                  type="button"
                  onClick={() => onSelectDataset?.(dataset.id)}
                  data-active={isActive}
                  className={`analytics-dataset-toggle rounded-full border px-3 py-1.5 text-sm font-semibold transition ${
                    isActive
                      ? "border-teal-200 bg-teal-50 text-teal-800 shadow-sm"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
                  }`}
                >
                  {dataset.shortLabel || dataset.label}
                </button>
              );
            })}
          </div>
        ) : null}
      </CardHeader>

      <CardContent className="space-y-5">{children}</CardContent>
    </Card>
  );
}
