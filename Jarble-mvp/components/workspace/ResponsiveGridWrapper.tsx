"use client";

// This file exists to properly import react-grid-layout
// WidthProvider is exported from the legacy submodule

import { WidthProvider, Responsive } from "react-grid-layout/legacy";

const ResponsiveGridLayout = WidthProvider(Responsive);

export default ResponsiveGridLayout;

