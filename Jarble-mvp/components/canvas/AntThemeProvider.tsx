"use client";

import { ConfigProvider, theme } from "antd";
import type { ReactNode } from "react";

const darkTheme = {
  algorithm: theme.darkAlgorithm,
  token: {
    colorPrimary: "#e4e4e7",
    colorBgContainer: "#111113",
    colorBorder: "#232326",
    colorText: "#f4f4f5",
    colorTextSecondary: "#a1a1aa",
    borderRadius: 12,
    fontFamily: "Inter, sans-serif",
  },
};

export default function AntThemeProvider({ children }: { children: ReactNode }) {
  return <ConfigProvider theme={darkTheme}>{children}</ConfigProvider>;
}
