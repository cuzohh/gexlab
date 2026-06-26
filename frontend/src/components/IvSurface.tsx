'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import type { SurfaceData } from '../types/analytics';

// Plotly is heavy, load dynamically
const Plot = dynamic(() => import('react-plotly.js'), { ssr: false }) as any;

interface IvSurfaceProps {
  surfaceData: SurfaceData;
}

export default function IvSurface({ surfaceData }: IvSurfaceProps) {
  if (!surfaceData || !surfaceData.matrix) return <div className="text-zinc-600">Loading Surface...</div>;

  const surfaceMin = Math.min(...surfaceData.matrix.flat());
  const surfaceMax = Math.max(...surfaceData.matrix.flat());
  const midpoint = surfaceMin + (surfaceMax - surfaceMin) / 2;

  return (
    <div className="overflow-hidden rounded-[2rem] border border-[#e4dbcd] bg-[radial-gradient(circle_at_top,#fffaf0_0%,#f5efe4_45%,#efe6d8_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.65),0_18px_55px_rgba(45,33,17,0.06)] dark:border-white/10 dark:bg-[radial-gradient(circle_at_top,#1a1f28_0%,#151922_45%,#10141b_100%)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_18px_55px_rgba(0,0,0,0.32)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e5dccd] px-5 py-4 dark:border-white/10">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#8b7f6d] dark:text-[#c8bbab]">Surface Studio</p>
          <p className="mt-1 text-sm text-[#6d6255] dark:text-[#a79b8b]">Warm topography tuned to the rest of the dashboard instead of a generic dark chart skin.</p>
        </div>
        <div className="flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.22em] text-[#786c5d] dark:text-[#b8ac9b]">
          <span className="rounded-full border border-[#e2d8c7] bg-white/70 px-3 py-1.5 dark:border-white/10 dark:bg-white/6">Low {(surfaceMin * 100).toFixed(1)}%</span>
          <span className="rounded-full border border-[#e2d8c7] bg-white/70 px-3 py-1.5 dark:border-white/10 dark:bg-white/6">Mid {(midpoint * 100).toFixed(1)}%</span>
          <span className="rounded-full border border-[#e2d8c7] bg-white/70 px-3 py-1.5 dark:border-white/10 dark:bg-white/6">High {(surfaceMax * 100).toFixed(1)}%</span>
        </div>
      </div>
      <div className="h-[30rem] w-full">
        <Plot
          data={[
            {
              z: surfaceData.matrix,
              x: surfaceData.strikes,
              y: surfaceData.expiries,
              type: 'surface',
              colorscale: [
                [0, '#f7e7be'],
                [0.24, '#ddb56a'],
                [0.5, '#b8860b'],
                [0.75, '#7a5837'],
                [1, '#34261a'],
              ],
              showscale: false,
              opacity: 0.96,
              contours: {
                z: {
                  show: true,
                  usecolormap: false,
                  color: '#fff8eb',
                  width: 2,
                  project: { z: true },
                },
              },
              lighting: {
                ambient: 0.75,
                diffuse: 0.9,
                specular: 0.35,
                roughness: 0.8,
                fresnel: 0.15,
              },
            },
          ]}
          layout={{
            autosize: true,
            paper_bgcolor: 'rgba(0,0,0,0)',
            plot_bgcolor: 'rgba(0,0,0,0)',
            margin: { l: 0, r: 0, b: 0, t: 0 },
            dragmode: false,
            scene: {
              bgcolor: 'rgba(0,0,0,0)',
              xaxis: {
                title: { text: 'Strike', font: { color: '#6f634f', size: 11 } },
                gridcolor: '#e8dfd1',
                zerolinecolor: '#ddd1bd',
                showbackground: true,
                backgroundcolor: '#fbf5eb',
                tickfont: { color: '#7c6f5b', size: 10 },
              },
              yaxis: {
                title: { text: 'Expiry', font: { color: '#6f634f', size: 11 } },
                gridcolor: '#e8dfd1',
                zerolinecolor: '#ddd1bd',
                showbackground: true,
                backgroundcolor: '#f9f2e6',
                tickfont: { color: '#7c6f5b', size: 10 },
              },
              zaxis: {
                title: { text: 'IV', font: { color: '#6f634f', size: 11 } },
                gridcolor: '#e2d8c7',
                zerolinecolor: '#d8ccb7',
                showbackground: true,
                backgroundcolor: '#f3e8d7',
                tickfont: { color: '#7c6f5b', size: 10 },
              },
              camera: {
                eye: { x: 1.55, y: 1.42, z: 1.05 },
              },
            },
          }}
          useResizeHandler={true}
          style={{ width: '100%', height: '100%' }}
          config={{ displayModeBar: false, responsive: true, scrollZoom: false, staticPlot: false }}
        />
      </div>
    </div>
  );
}
