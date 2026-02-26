// Type declarations for packages that are in package.json but not yet installed
// (planned for the Moveable Canvas Workspace feature)

declare module "react-rnd" {
  import { Component, CSSProperties, ReactNode } from "react";

  interface RndProps {
    position?: { x: number; y: number };
    size?: { width: number | string; height: number | string };
    minWidth?: number | string;
    minHeight?: number | string;
    maxWidth?: number | string;
    maxHeight?: number | string;
    style?: CSSProperties;
    className?: string;
    dragHandleClassName?: string;
    enableResizing?: boolean | Record<string, boolean>;
    disableDragging?: boolean;
    bounds?: string | HTMLElement;
    onDragStart?: (e: any, data: any) => void;
    onDrag?: (e: any, data: any) => void;
    onDragStop?: (e: any, data: { x: number; y: number }) => void;
    onResizeStart?: (e: any, direction: string, ref: HTMLElement) => void;
    onResize?: (e: any, direction: string, ref: HTMLElement, delta: any, position: { x: number; y: number }) => void;
    onResizeStop?: (e: any, direction: string, ref: HTMLElement, delta: any, position: { x: number; y: number }) => void;
    onMouseDown?: (e: any) => void;
    children?: ReactNode;
  }

  export class Rnd extends Component<RndProps> {}
}

declare module "react-grid-layout/legacy" {
  import { ComponentType, ReactNode } from "react";

  interface Layout {
    i: string;
    x: number;
    y: number;
    w: number;
    h: number;
    minW?: number;
    minH?: number;
    maxW?: number;
    maxH?: number;
    static?: boolean;
    isDraggable?: boolean;
    isResizable?: boolean;
  }

  type Layouts = Record<string, Layout[]>;

  interface ResponsiveProps {
    className?: string;
    layouts?: Layouts;
    breakpoints?: Record<string, number>;
    cols?: Record<string, number>;
    rowHeight?: number;
    margin?: [number, number];
    containerPadding?: [number, number];
    isDraggable?: boolean;
    isResizable?: boolean;
    isBounded?: boolean;
    useCSSTransforms?: boolean;
    compactType?: "vertical" | "horizontal" | null;
    preventCollision?: boolean;
    draggableHandle?: string;
    draggableCancel?: string;
    resizeHandles?: string[];
    onLayoutChange?: (layout: Layout[], layouts: Layouts) => void;
    onBreakpointChange?: (breakpoint: string, cols: number) => void;
    onDragStart?: (...args: any[]) => void;
    onDrag?: (...args: any[]) => void;
    onDragStop?: (...args: any[]) => void;
    onResizeStart?: (...args: any[]) => void;
    onResize?: (...args: any[]) => void;
    onResizeStop?: (...args: any[]) => void;
    children?: ReactNode;
  }

  export const Responsive: ComponentType<ResponsiveProps>;
  export function WidthProvider<P>(component: ComponentType<P>): ComponentType<P>;
}
