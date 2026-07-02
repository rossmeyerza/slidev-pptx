// Screenshot-export types

export interface IRSlide {
  index: number;
  image: string; // data: URI of the full-bleed slide screenshot
}

export interface IRDeck {
  slideWidth: number;   // inches (10)
  slideHeight: number;  // inches (5.625 for 16:9)
  slides: IRSlide[];
}

export interface VerificationResult {
  ok: boolean;
  slideCount: number;
  imageCount: number;
  expectedImageWidth: number;
  expectedImageHeight: number;
  errors: string[];
}
