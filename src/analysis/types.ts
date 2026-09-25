import * as vscode from 'vscode';

export type FindingSeverity = 'error' | 'warning' | 'info';

export interface Finding {
  range: vscode.Range;
  severity: FindingSeverity;
  message: string;
  /** O que isso pode quebrar em outra função/arquivo do subgrafo — vazio quando não há impacto cruzado identificado. */
  impact?: string;
  source: 'grafo' | 'ia';
}

/** Finding depois de passar pelo FindingsCache — ganhou um ID estável e datas de primeira/última vez visto. */
export interface StoredFinding extends Finding {
  id: string;
  firstSeen: string;
  lastSeen: string;
}
