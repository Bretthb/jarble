"use client";

import { memo } from "react";
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
  height?: number;
}

function CanvasMapInner({
  center,
  zoom = 13,
  markers = [],
  title,
  height,
}: CanvasMapProps) {
  // Use explicit height if provided, otherwise fill container
  const useFlexHeight = height === undefined;
  const containerStyle = useFlexHeight
    ? { display: "flex", flexDirection: "column" as const, height: "100%", minHeight: 200 }
    : {};

  return (
    <div className="p-3 h-full" style={containerStyle}>
      {title && (
        <h3 className="text-sm font-semibold text-foreground mb-3 shrink-0">{title}</h3>
      )}
      <div className="overflow-hidden rounded-lg" style={useFlexHeight ? { flex: 1, minHeight: 0 } : { height: height || 350 }}>
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
            <Marker key={`${marker.lat}-${marker.lng}-${i}`} position={[marker.lat, marker.lng]}>
              {marker.label && <Popup>{marker.label}</Popup>}
            </Marker>
          ))}
        </MapContainer>
      </div>
    </div>
  );
}

export default memo(CanvasMapInner);
