import React, { useEffect, useState } from "react";

type Props = {
  size?: number;
  className?: string;
  alt?: string;
};

export default function OneNationUpIcon({ size = 18, className = "", alt = "1NationUp" }: Props) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, []);

  if (failed) {
    const fontSize = Math.max(8, Math.round(size * 0.42));
    return (
      <span
        role="img"
        aria-label={alt}
        className={`inline-flex items-center justify-center rounded-[28%] border border-white/12 bg-[linear-gradient(135deg,rgba(126,170,237,0.24),rgba(223,177,66,0.24),rgba(222,108,83,0.24))] text-white font-black shadow-[0_10px_24px_rgba(0,0,0,0.24)] ${className}`}
        style={{ width: size, height: size, fontSize, lineHeight: 1 }}
      >
        1
      </span>
    );
  }

  return (
    <img
      src="/brands/1nation-up/logo.png"
      alt={alt}
      width={size}
      height={size}
      className={`oneNation-icon ${className}`}
      decoding="async"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
