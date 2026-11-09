// One shared JSON Schema validator for workflow inputs.
import { Ajv } from "ajv";
import addFormatsPlugin from "ajv-formats";

// ajv-formats is CommonJS; under ESM its function sits on `.default`.
const addFormats = ((addFormatsPlugin as unknown as { default?: typeof addFormatsPlugin }).default ??
  addFormatsPlugin) as unknown as (ajv: Ajv) => Ajv;

export const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
