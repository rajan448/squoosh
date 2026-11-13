# HEIC fixtures

`quadrants.heic` is a generated 32 × 24 image, created for these tests with
macOS ImageIO (`sips -s format heic`). It contains blue/white quadrants at the
top and red/green quadrants at the bottom. There is no third-party image content.

To additionally test a real camera image, set `HEIC_TEST_IMAGE` to its path when
running `npm run test:heic`. For example, the upstream libheif repository has
`examples/example.heic` (1280 × 854).

`rotated-primary.heic` contains two HEVC image items sharing the generated
pixels. The second item is declared primary and has a 90° counterclockwise
container rotation, producing 24 × 32 output. Recreate it with
`node tests/fixtures/generate-primary.cjs`.
