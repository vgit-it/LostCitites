// A QR code, as a matrix of dark/light modules and then as one SVG path.
//
// The library does the encoding — Reed-Solomon, mask selection, format bits
// — which is the part worth not hand-rolling: a broken encoder produces a
// code that looks exactly as plausible as a working one and simply does not
// scan. Everything past `isDark()` is ours, so the result renders in the
// app's own palette instead of the library's black-on-white markup.

import qrcode from 'qrcode-generator';

/** `true` is a dark module. Auto version, mid error correction. */
export function qrMatrix(text: string): boolean[][] {
  const code = qrcode(0, 'M');
  code.addData(text);
  code.make();

  const modules = code.getModuleCount();
  const matrix: boolean[][] = [];
  for (let row = 0; row < modules; row += 1) {
    const cells: boolean[] = [];
    for (let col = 0; col < modules; col += 1) cells.push(code.isDark(row, col));
    matrix.push(cells);
  }
  return matrix;
}

/**
 * One `<path>` worth of dark modules, one unit square each, inset by a quiet
 * zone on every side.
 *
 * The quiet zone is not decoration — below about four modules of blank
 * border many phone cameras will not lock onto the code at all, scanner or
 * no scanner.
 */
export function qrPath(matrix: boolean[][], quiet = 4): { d: string; size: number } {
  const modules = matrix.length;
  let d = '';
  for (let row = 0; row < modules; row += 1) {
    for (let col = 0; col < modules; col += 1) {
      if (matrix[row][col]) d += `M${col + quiet} ${row + quiet}h1v1h-1z`;
    }
  }
  return { d, size: modules + quiet * 2 };
}
