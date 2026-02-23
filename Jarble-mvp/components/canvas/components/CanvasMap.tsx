"use client";

import dynamic from "next/dynamic";

// Leaflet CSS must be imported for proper rendering
import "leaflet/dist/leaflet.css";

const MapContainer = dynamic(
  () => import("react-leaflet").then((m) => m.MapContainer),
  { ssr: false }
);
const TileLayer = dynamic(
  () => import("react-leaflet").then((m) => m.TileLayer),
  { ssr: false }
);
const Marker = dynamic(
  () => import("react-leaflet").then((m) => m.Marker),
  { ssr: false }
);
const Popup = dynamic(
  () => import("react-leaflet").then((m) => m.Popup),
  { ssr: false }
);

export interface CanvasMapProps {
  center: [number, number];
  zoom?: number;
  markers?: { lat: number; lng: number; label?: string }[];
  title?: string;
}

export default function CanvasMap({
  center,
  zoom = 13,
  markers = [],
  title,
}: CanvasMapProps) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      {title && (
        <h3 className="text-sm font-semibold text-foreground mb-3">{title}</h3>
      )}
      <div className="overflow-hidden rounded-lg" style={{ height: 350 }}>
        <MapContainer
          center={center}
          zoom={zoom}
          style={{ height: "100%", width: "100%" }}
          scrollWheelZoom={false}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {markers.map((marker, i) => (
            <Marker key={i} position={[marker.lat, marker.lng]}>
              {marker.label && <Popup>{marker.label}</Popup>}
            </Marker>
          ))}
        </MapContainer>
      </div>
    </div>
  );
}
