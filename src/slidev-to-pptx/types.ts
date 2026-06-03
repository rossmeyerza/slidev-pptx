// Intermediate Representation types

export interface IRTableCell {
  text: string;
  bold?: boolean;
  color?: string;
  align?: 'left' | 'center' | 'right';
}

export interface IRTableElement {
  type: 'table';
  x: number;
  y: number;
  w: number;
  h: number;
  zIndex: number;
  rows: { cells: IRTableCell[] }[];
  fontSize?: number;
  fontFamily?: string;
}

export interface IRBaseElement {
  type: 'text' | 'image' | 'code-image' | 'shape';
  x: number;      // inches
  y: number;      // inches
  w: number;      // inches
  h: number;      // inches
  zIndex: number;
  // text fields
  content?: string;
  fontSize?: number;   // pt
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;      // hex
  align?: 'left' | 'center' | 'right';
  fontFamily?: string;
  lineHeight?: number;
  // image fields
  src?: string;        // URL or base64
  // background
  backgroundColor?: string;
  borderRadius?: number;
  borderColor?: string;
  borderWidth?: number;
}

export type IRElement = IRBaseElement | IRTableElement;

export interface IRSlide {
  index: number;
  backgroundColor?: string;
  backgroundImage?: string;
  elements: IRElement[];
}

export interface IRDeck {
  slideWidth: number;   // inches (10)
  slideHeight: number;  // inches (5.625 for 16:9)
  slides: IRSlide[];
}

export interface DOMNode {
  tag: string;
  text: string;
  html: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  children: DOMNode[];
  styles: Record<string, string>;
  isVisible: boolean;
  isLeaf: boolean;
  imageSrc?: string;
}

export interface ExtractedSlide {
  nodes: DOMNode[];
  backgroundColor?: string;
  backgroundImage?: string;
}

export interface VerificationResult {
  ok: boolean;
  slideCount: number;
  imageCount: number;
  expectedImageWidth: number;
  expectedImageHeight: number;
  errors: string[];
}
