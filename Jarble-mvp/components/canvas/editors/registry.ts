import type { ComponentType } from "react";
import DataTableEditor from "./DataTableEditor";
import CardEditor from "./CardEditor";
import KeyValueEditor from "./KeyValueEditor";
import StatGridEditor from "./StatGridEditor";
import AlertEditor from "./AlertEditor";
import CodeBlockEditor from "./CodeBlockEditor";
import ProgressEditor from "./ProgressEditor";
import LayoutEditor from "./LayoutEditor";

export { default as FallbackJsonEditor } from "./FallbackJsonEditor";

export interface EditorProps {
  props: Record<string, unknown>;
  onChange: (props: Record<string, unknown>) => void;
  disabled?: boolean;
}

export const EDITOR_COMPONENTS: Record<string, ComponentType<EditorProps>> = {
  data_table: DataTableEditor,
  card: CardEditor,
  key_value: KeyValueEditor,
  stat_grid: StatGridEditor,
  alert: AlertEditor,
  code_block: CodeBlockEditor,
  progress: ProgressEditor,
  layout: LayoutEditor,
};
