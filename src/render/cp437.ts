/**
 * CP437 to Unicode, for the letter fallback.
 *
 * Convert_Format stores unmapped layout characters as their own byte, and
 * Display_Playfield prints `upcase(chr(...))` -- in code page 437, the IBM PC
 * character set. Bytes 32..126 agree with ASCII, so prose renders correctly
 * either way, but the box-drawing and symbol range does not: byte 196 is the
 * horizontal rule the levels use as a divider, not Latin-1's "A-umlaut".
 */

/** Bytes 0..31: CP437 renders these as symbols rather than control codes. */
const LOW = ' ☺☻♥♦♣♠•◘○◙♂♀♪♫☼►◄↕‼¶§▬↨↑↓→←∟↔▲▼';

/** Bytes 128..255. */
const HIGH =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒ' +
  'áíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐' +
  '└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀' +
  'αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';

export function cp437(byte: number): string {
  // `upcase` only touches a..z; everything else passes through unchanged.
  if (byte >= 0x61 && byte <= 0x7a) return String.fromCharCode(byte - 32);
  if (byte >= 0x20 && byte < 0x7f) return String.fromCharCode(byte);
  if (byte < 0x20) return LOW[byte] ?? ' ';
  if (byte >= 0x80) return HIGH[byte - 0x80] ?? ' ';
  return ' ';
}
