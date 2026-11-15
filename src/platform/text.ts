/** String inputs that end up in PostgreSQL, which cannot store a NUL character in text. */
import { z } from "zod";

/**
 * A string input without NUL characters. PostgreSQL fails the whole query on one, which would
 * surface as a 500; rejecting it here answers 422 like any other invalid input.
 * @returns A Zod string schema to refine further (`.trim()`, `.min()`, ...).
 */
export const text = () => z.string().regex(/^[^\u0000]*$/, "Must not contain a NUL character");
