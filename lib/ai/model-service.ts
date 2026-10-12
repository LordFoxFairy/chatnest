import { getDirectCapabilities, getModelConnection } from "./model-connection";
import {
  getModelAvailability as getGatewayAvailability,
  getCapabilities as getGatewayCapabilities,
} from "./models";

export function getCapabilities() {
  return getModelConnection().provider === "openai"
    ? Promise.resolve(getDirectCapabilities())
    : getGatewayCapabilities();
}

export function getModelAvailability(modelId: string) {
  return getModelConnection().provider === "openai"
    ? Promise.resolve("unknown" as const)
    : getGatewayAvailability(modelId);
}
