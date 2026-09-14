/**
 * The Chaatak mark, inlined so it takes `currentColor` from the header.
 *
 * Sizing rule from the brand: the full mark at 40px and above, the cropped
 * head below — the full mark fills in and stops reading at small sizes. The
 * header uses it at 40px, which is the floor for this version.
 */

export function LogoMark({ size = 40 }: { size?: number }) {
  return (
    <svg
      className="logo-mark"
      viewBox="0 30 400 330"
      height={size}
      width={(size * 400) / 330}
      role="img"
      aria-label="Chaatak"
    >
      <g fill="currentColor">
        <clipPath id="chaatak-logo-clip">
          <rect x="0" y="0" width="338" height="208" />
        </clipPath>
        <g transform="translate(4 48) scale(0.98)">
          <g clipPath="url(#chaatak-logo-clip)">
            <g transform="translate(0,361) scale(0.1,-0.1)">
              <path
                d="M2952 3524 c-29 -7 -78 -26 -110 -42 l-57 -28 -50 19 c-134 51 -265
32 -515 -77 -245 -107 -336 -130 -508 -124 -62 1 -112 2 -112 1 0 -1 19 -14
43 -28 83 -48 154 -67 281 -72 l119 -6 -34 -17 c-30 -16 -72 -27 -164 -46 -41
-8 -19 -18 84 -39 56 -12 103 -15 141 -11 l57 7 -19 -73 c-70 -272 -86 -297
-257 -413 -309 -208 -554 -468 -784 -832 -56 -87 -88 -120 -444 -450 -13 -13
-20 -23 -15 -23 8 0 191 54 335 100 38 12 71 19 74 16 3 -3 -30 -54 -73 -113
-43 -59 -103 -142 -134 -184 -259 -358 -337 -465 -494 -679 -98 -135 -194
-266 -213 -293 l-35 -47 454 0 453 0 -42 21 c-197 97 -239 371 -80 528 46 46
131 91 186 98 l36 5 0 101 c0 119 17 162 125 315 329 465 290 421 415 468 523
194 770 423 794 734 l7 85 12 -40 c19 -63 15 -222 -7 -286 -84 -245 -271 -405
-666 -570 -82 -34 -160 -71 -173 -83 -19 -16 -158 -207 -185 -253 -5 -8 15
-10 75 -6 46 3 85 10 86 15 13 33 106 138 161 183 165 132 348 194 548 183
l88 -5 58 45 c278 218 402 575 355 1031 -15 152 -3 222 73 415 68 171 79 185
213 264 l80 47 -41 3 c-46 3 -162 -32 -255 -78 -80 -40 -81 -39 -18 26 87 88
212 167 310 195 42 11 43 13 20 20 -41 12 -141 9 -198 -7z"
                fill="currentColor"
              />
            </g>
          </g>
        </g>
        <g transform="translate(70 246) scale(1.9)">
          <path
            d="M22 74 C11 74 4 66 6 56 C8 47 17 42 25 45 C26 32 38 23 51 26 C58 14 76 12 85 23 C93 20 102 26 102 36 C112 37 118 46 115 56 C113 67 104 74 93 74 Z"
            fill="currentColor"
          />
        </g>
      </g>
    </svg>
  );
}
