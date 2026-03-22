/** File entry returned by the list directory API */
export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: string;
}

/** Upload progress state */
export interface TransferProgress {
  filename: string;
  loaded: number;
  total: number;
  percent: number;
}
