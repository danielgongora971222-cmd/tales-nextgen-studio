import React from "react";

export type IconName =
  | "heart"
  | "money"
  | "share"
  | "download"
  | "trash"
  | "close"
  | "copy"
  | "reuse"
  | "model"
  | "sliders"
  | "clock"
  | "elements"
  | "multishot"
  | "sound"
  | "speed"
  | "mode"
  | "image"
  | "upload"
  | "video"
  | "swap";

export function Icon({ name }: { name: IconName }) {
  switch (name) {
    case "model":
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="currentColor"
            d="M12 2 3 7v10l9 5 9-5V7l-9-5zm0 2.2L19 8l-7 3.8L5 8l7-3.8zm-7 5.9 6 3.3v6.4l-6-3.3v-6.4zm8 9.7v-6.4l6-3.3v6.4l-6 3.3z"
          />
        </svg>
      );
    case "sliders":
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="currentColor"
            d="M4 21v-7h2v7H4zm0-11V3h2v7H4zM11 21v-11h2v11h-2zm0-15V3h2v3h-2zM18 21v-3h2v3h-2zm0-7V3h2v11h-2z"
          />
        </svg>
      );
    case "clock":
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="currentColor"
            d="M12 2a10 10 0 1 0 .001 20.001A10 10 0 0 0 12 2zm1 11h5v-2h-4V7h-2v6z"
          />
        </svg>
      );
    case "elements":
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="currentColor"
            d="M4 6h16v2H4V6zm0 5h10v2H4v-2zm0 5h16v2H4v-2z"
          />
        </svg>
      );
    case "multishot":
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="currentColor"
            d="M4 7h6v10H4V7zm10 0h6v10h-6V7z"
          />
        </svg>
      );
    case "sound":
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="currentColor"
            d="M3 10v4h4l5 4V6L7 10H3zm13.5 2a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zm0-7a9 9 0 0 1 0 14l-1.4-1.4a7 7 0 0 0 0-11.2L16.5 5z"
          />
        </svg>
      );
    case "speed":
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="currentColor"
            d="M12 4a9 9 0 1 0 9 9h-2a7 7 0 1 1-7-7V4zm1 5h-2v5h5v-2h-3V9z"
          />
        </svg>
      );
    case "mode":
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="currentColor"
            d="M12 2l4 8-4 12-4-12 4-8zm0 5.2L10.6 10h2.8L12 7.2z"
          />
        </svg>
      );
    case "money":
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="currentColor"
            d="M3 7a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7zm3-1a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1H6zm6 2c2.2 0 4 1.34 4 3s-1.8 3-4 3-4-1.34-4-3 1.8-3 4-3zm0 2c-1.2 0-2 .62-2 1s.8 1 2 1 2-.62 2-1-.8-1-2-1z"
          />
        </svg>
      );
    case "copy":
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path fill="currentColor" d="M16 1H4v14h2V3h10V1zm4 4H8v18h12V5zm-2 16H10V7h8v14z" />
        </svg>
      );
    case "reuse":
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="currentColor"
            d="M12 6V3L8 7l4 4V8c2.8 0 5 2.2 5 5a5 5 0 0 1-9.6 2H5.2A7 7 0 0 0 19 13c0-3.9-3.1-7-7-7z"
          />
        </svg>
      );
    case "download":
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path fill="currentColor" d="M5 20h14v-2H5v2zm7-18v10l4-4 1.4 1.4L12 15.8 6.6 9.4 8 8l4 4V2h0z" />
        </svg>
      );
    case "trash":
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path fill="currentColor" d="M6 7h12l-1 14H7L6 7zm3-3h6l1 2H8l1-2z" />
        </svg>
      );
    case "share":
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path fill="currentColor" d="M18 16a3 3 0 0 0-2.4 1.2L8.9 13.7a3.1 3.1 0 0 0 0-3.4l6.7-3.5A3 3 0 1 0 15 5a3 3 0 0 0 .1.7L8.4 9.2A3 3 0 1 0 9 15a3 3 0 0 0-.6-1.8l6.7 3.5A3 3 0 1 0 18 16z" />
        </svg>
      );
    case "swap":
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path fill="currentColor" d="M7 7h11l-3-3 1.4-1.4L22 8l-5.6 5.4L15 12l3-3H7V7zm10 10H6l3 3-1.4 1.4L2 16l5.6-5.4L9 12l-3 3h11v2z" />
        </svg>
      );
    case "image":
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path fill="currentColor" d="M21 19V5H3v14h18zM5 7h14v10H5V7zm3 8 2-3 2 2 3-4 2 5H8z" />
        </svg>
      );
    case "upload":
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path fill="currentColor" d="M5 20h14v-2H5v2zm7-18 5 5h-3v6h-4V7H7l5-5z" />
        </svg>
      );
    case "video":
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="currentColor"
            d="M4 6h10a2 2 0 0 1 2 2v1.2l4-2.3v10.2l-4-2.3V16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zm10 10V8H4v8h10z"
          />
        </svg>
      );
    case "close":
    default:
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="currentColor"
            d="M18.3 5.71 12 12l6.3 6.29-1.41 1.42L10.59 13.4 4.29 19.71 2.88 18.29 9.17 12 2.88 5.71 4.29 4.29l6.3 6.3 6.29-6.3z"
          />
        </svg>
      );
  }
}
