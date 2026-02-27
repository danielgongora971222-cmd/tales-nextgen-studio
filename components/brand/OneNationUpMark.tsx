import React from "react";
import OneNationUpIcon from "@/components/brand/OneNationUpIcon";

type Props = {
  text?: string;
  size?: number;
  className?: string;
  textClassName?: string;
};

export default function OneNationUpMark({
  text = "1NationUp Store",
  size = 18,
  className = "",
  textClassName = "",
}: Props) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <OneNationUpIcon size={size} />
      <span className={`oneNation-gradientText ${textClassName}`}>{text}</span>
    </span>
  );
}