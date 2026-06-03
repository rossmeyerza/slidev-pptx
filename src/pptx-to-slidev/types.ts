// Intermediate Representation — units in inches for positions, points for font sizes.

export interface IRTextRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  fontSize?: number;     // pt
  fontFamily?: string;
  color?: string;        // hex like "1C2833"
}

export interface IRParagraph {
  runs: IRTextRun[];
  align?: 'left' | 'center' | 'right' | 'justify';
  bullet?: { kind: 'bullet' | 'number'; char?: string };
  indentLevel?: number;
  lineHeightPt?: number;
  spaceBeforePt?: number;
  spaceAfterPt?: number;
}

export interface IRBox {
  x: number;             // inches
  y: number;             // inches
  w: number;             // inches
  h: number;             // inches
  rotation?: number;     // degrees
  zIndex: number;
}

export interface IRFill {
  color?: string;        // hex
}

export interface IRBorder {
  color?: string;
  widthPt?: number;
}

export interface IRTextElement extends IRBox {
  type: 'text';
  paragraphs: IRParagraph[];
  fill?: IRFill;
  border?: IRBorder;
  borderRadius?: number; // px-equivalent (CSS)
  paddingPt?: { top: number; right: number; bottom: number; left: number };
  vAlign?: 'top' | 'middle' | 'bottom';
}

export interface IRImageElement extends IRBox {
  type: 'image';
  src: string;           // relative path within output assets dir
  mimeType?: string;
}

export interface IRShapeElement extends IRBox {
  type: 'shape';
  fill?: IRFill;
  border?: IRBorder;
  borderRadius?: number;
  prstGeom?: string;     // e.g. "rect", "ellipse"
}

export interface IRTableCell {
  paragraphs: IRParagraph[];
  fill?: IRFill;
  vAlign?: 'top' | 'middle' | 'bottom';
  rowSpan?: number;
  colSpan?: number;
}

export interface IRTableElement extends IRBox {
  type: 'table';
  rows: { height?: number; cells: IRTableCell[] }[];
  colWidths?: number[];  // inches
}

export type IRElement = IRTextElement | IRImageElement | IRShapeElement | IRTableElement;

export interface IRSlide {
  index: number;
  background?: IRFill;
  backgroundImage?: string;
  elements: IRElement[];
}

export interface IRDeck {
  slideWidth: number;    // inches
  slideHeight: number;   // inches
  slides: IRSlide[];
  assets: Map<string, Buffer>; // key: asset filename, value: raw bytes
}
