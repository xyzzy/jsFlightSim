/*
 *  This file is part of jsFlightSim - Ultra-fast GIF encoder for data URL written in javascript
 *
 *  Copyright (C) 2018, xyzzy@rockingship.org
 *
 *  This program is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU Affero General Public License as published
 *  by the Free Software Foundation, either version 3 of the License, or
 *  (at your option) any later version.
 *
 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU Affero General Public License for more details.
 *
 *  You should have received a copy of the GNU Affero General Public License
 *  along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/**
 *
 * @param width {number} - width in pixels
 * @param height {number} - height in pixels
 * @constructor
 */
function GifEncoder(width, height) {

	/*
	 * Allocate (worstcase) persistent storage for result
	 * 
	 * worst case uncompressed (8bpp) uses 1810 24bit words for 3839 pixels
	 */

	this.out_store = new Uint32Array(
		Math.floor(29 / 3) + // headers
		256 + // colormap
		(Math.floor(width * height / 3838) + 1) * 1811 + // pixels
		32 // unforeseen
	);

	/**
	 * Precalculate 2 adjacent base64 characters (2*6 bits = 4096 combos)
	 *
	 * @type {string[]}
	 */
	this.base64Pair = new Array(4096);

	var base64Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
	for (var i=0; i<4096; i++)
		this.base64Pair[i] = base64Chars[(i >> 6) & 63] + base64Chars[(i >> 0) & 63];

	/**
	 * Encode
	 * 
	 * @param bpp {number} - bits per pixel (max 8 for 256 colours)
	 * @param red {number[]} - red palette
	 * @param green {number[]} - green palette
	 * @param blue {number[]} - blue palette
	 * @param pixels {number[]} - color indexed pixel data
	 * @returns {string} - result
	 */
	this.encode = function(bpp, red, green, blue, pixels) {
		var n_bits = bpp + 1;
		var maxcode = (1 << n_bits) - 1;
		var CLRcode = 1 << bpp;
		var EOFcode = CLRcode + 1;
		var curcode = CLRcode + 2;
		var out_accum = 0;
		var out_bits = 0;
		var out_len = 0;
		var out_store = this.out_store;
		var i, j, v;

		/**
		 * Slow function (only used for headers) to add byte
		 *
		 * @param v
		 */
		var putByte = function (v) {
			out_accum |= v << out_bits;
			if ((out_bits += 8) >= 24) {
				out_store[out_len++] = out_accum;
				out_accum = v >> (8 - (out_bits -= 24));
			}
		};

		/**
		 * Slow function (only used for headers) to add word
		 *
		 * @param v
		 */
		var putWord = function (v) {
			putByte(v & 255);
			putByte(v >> 8);
		};

		// Write the Magic header
		putByte(71); // G
		putByte(73); // I
		putByte(70); // F
		putByte(56); // 8
		putByte(57); // 9
		putByte(97); // a

		// Write out the screen width and height
		putWord(width);
		putWord(height);

		// global colour map | color resolution | Bits per Pixel
		putByte(128 | (bpp - 1) << 4 | (bpp - 1));

		// Write out the Background colour
		putByte(0);

		// Byte of 0's (future expansion)
		putByte(0);

		// Write out the Global Colour Map
		for (i = 0; i < CLRcode; ++i) {
			putByte(red[i]);
			putByte(green[i]);
			putByte(blue[i]);
		}

		// Write an Image separator
		putByte(44);

		// Write the Image header
		putWord(0); // left
		putWord(0); // top
		putWord(width);
		putWord(height);

		// Write out whether or not the image is interlaced
		putByte(0);

		// Write out the initial code size
		putByte(bpp);

		// mark
		var mark = out_len;
		out_accum |= 254;
		out_bits += 8;

		// place CLR in head of compressed stream
		var str = CLRcode;
		curcode--; // compensate for lack of previous symbol
		var hash = new Uint16Array(4096);

		// compress frame
		for (var xy = 0; xy < width * height; xy++) {
			var c = pixels[xy];

			var fcode = (c << 12) | str;
			if ((v = hash[fcode])) {
				str = v;
			} else {
				v = str;
				out_accum |= v << out_bits;
				if ((out_bits += n_bits) >= 24) {
					out_store[out_len++] = out_accum;
					out_accum = v >> (n_bits - (out_bits -= 24));

					if ((v = out_len - mark) >= 85) {
						mark = out_len;
						out_accum <<= 8;
						out_accum |= 254;
						out_bits += 8;
					}
				}

				str = c;

				if (curcode < 4096) {
					hash[fcode] = curcode;
					if (curcode++ > maxcode)
						maxcode = (1 << ++n_bits) - 1;
				} else {
					// CLEAR
					v = CLRcode;
					out_accum |= v << out_bits;
					if ((out_bits += n_bits) >= 24) {
						out_store[out_len++] = out_accum;
						out_accum = v >> (n_bits - (out_bits -= 24));

						if ((v = out_len - mark) >= 85) {
							mark = out_len;
							out_accum <<= 8;
							out_accum |= 254;
							out_bits += 8;
						}
					}

					// reset codes
					n_bits = bpp + 1;
					maxcode = (1 << n_bits) - 1;
					curcode = CLRcode + 2;
					hash = new Uint16Array(4096);
				}
			}
		}

		// last code
		v = str;
		out_accum |= v << out_bits;
		if ((out_bits += n_bits) >= 24) {
			out_store[out_len++] = out_accum;
			out_accum = v >> (n_bits - (out_bits -= 24));

			if ((v = out_len - mark) >= 85) {
				mark = out_len;
				out_accum <<= 8;
				out_accum |= 254;
				out_bits += 8;
			}
		}

		// EOF
		v = EOFcode;
		out_accum |= v << out_bits;
		if ((out_bits += n_bits) >= 24) {
			out_store[out_len++] = out_accum;
			out_accum = v >> (n_bits - (out_bits -= 24));

			if ((v = out_len - mark) >= 85) {
				mark = out_len;
				out_accum <<= 8;
				out_accum |= 254;
				out_bits += 8;
			}
		}

		if (mark === out_bits && out_bits === 8) {
			// undo mark
			out_accum >>= 8;
			out_bits -= 8;
		} else {
			// FLUSH
			v = (out_len - mark) * 3 - 1;
			if (out_bits > 16) {
				out_bits = 24;
				v += 3;
				out_store[out_len++] = out_accum;
				out_bits = out_accum = 0;
			} else if (out_bits > 8) {
				out_bits = 16;
				v += 2;
			} else if (out_bits > 0) {
				out_bits = 8;
				v += 1;
			}
			out_store[mark] &= ~255;
			out_store[mark] |= v;
		}

		// Write out a Zero-length packet (to end the series)
		putByte(0);

		// Write the GIF file terminator
		putByte(59);

		// fast flush
		putByte(0);
		putByte(0);
		putByte(0);

		// export as base64
		var res = new Array(out_len * 2 + 1);
		j = 0;
		res[j++] = "data:image/gif;base64,";
		for (i = 0; i < out_len; i++) {
			v = out_store[i];
			res[j++] = this.base64Pair[((v & 0x0000ff) << 4) | ((v & 0x00f000) >> 12)];
			res[j++] = this.base64Pair[((v & 0x000f00) << 0) | ((v & 0xff0000) >> 16)];
		}

		// return with appropriate header
		return  res.join('');
	}
	
}
