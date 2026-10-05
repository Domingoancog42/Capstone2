import { TextDecoder, TextEncoder } from "util";

// React Router 7 uses the platform encoding APIs. Browsers provide them natively; Jest's jsdom
// environment needs Node's equivalent exposed on the test global.
if (typeof global.TextEncoder === "undefined") {
  global.TextEncoder = TextEncoder;
}

if (typeof global.TextDecoder === "undefined") {
  global.TextDecoder = TextDecoder;
}
