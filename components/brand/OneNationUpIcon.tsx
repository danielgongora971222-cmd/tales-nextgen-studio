import React from "react";

type Props = {
  size?: number;
  className?: string;
  alt?: string;
};

export default function OneNationUpIcon({ size = 18, className = "", alt = "1Nation Up" }: Props) {
  return (
    <img
      src="/brands/1nation-up/logo.png"
      alt={alt}
      width={size}
      height={size}
      className={`oneNation-icon ${className}`}
      decoding="async"
      loading="lazy"
    />
  );
}