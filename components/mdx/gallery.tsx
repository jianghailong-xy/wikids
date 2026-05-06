"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface GalleryImage {
  src: string;
  alt: string;
  caption?: string;
}

export function Gallery({
  images,
  title,
}: {
  images: GalleryImage[];
  title?: string;
}) {
  const [index, setIndex] = useState(0);

  if (images.length === 0) return null;
  const current = images[index];

  function go(delta: number) {
    setIndex((i) => (i + delta + images.length) % images.length);
  }

  return (
    <figure
      className="not-prose my-8 overflow-hidden rounded-2xl border border-slate-200 bg-slate-900"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") go(-1);
        if (e.key === "ArrowRight") go(1);
      }}
      aria-label={title ?? "Image gallery"}
      aria-roledescription="carousel"
    >
      <div className="relative flex aspect-video items-center justify-center bg-slate-900">
        <img
          key={current.src}
          src={current.src}
          alt={current.alt}
          className="max-h-full max-w-full object-contain"
        />

        <button
          type="button"
          onClick={() => go(-1)}
          aria-label="Previous image"
          className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-white/90 p-2 text-slate-900 shadow-md transition hover:bg-white"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={() => go(1)}
          aria-label="Next image"
          className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-white/90 p-2 text-slate-900 shadow-md transition hover:bg-white"
        >
          <ChevronRight className="h-5 w-5" />
        </button>

        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/40 px-2.5 py-0.5 text-xs font-medium text-white">
          {index + 1} / {images.length}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 bg-white px-4 py-3">
        <figcaption className="text-sm text-slate-700">
          {current.caption ?? current.alt}
        </figcaption>
        <div className="flex shrink-0 gap-1.5">
          {images.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Go to image ${i + 1}`}
              aria-current={i === index}
              onClick={() => setIndex(i)}
              className={cn(
                "h-2 w-2 rounded-full transition",
                i === index
                  ? "w-5 bg-brand-600"
                  : "bg-slate-300 hover:bg-slate-400",
              )}
            />
          ))}
        </div>
      </div>
    </figure>
  );
}
