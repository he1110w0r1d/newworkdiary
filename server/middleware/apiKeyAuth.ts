import type { NextFunction, Request, Response } from "express";
import { findApiKey, hasScope, type ApiKeyRecord } from "../services/apiKeys";

declare global {
  namespace Express {
    interface Request {
      apiKey?: ApiKeyRecord;
    }
  }
}

export function requireApiKey(requiredScope: string | string[]) {
  return async (request: Request, response: Response, next: NextFunction) => {
    const rawKey = request.header("X-API-Key");

    if (!rawKey) {
      response.status(401).json({
        message: "X-API-Key header is required",
      });
      return;
    }

    const key = await findApiKey(rawKey);
    if (!key) {
      response.status(401).json({
        message: "Invalid or expired API key",
      });
      return;
    }

    const requiredScopes = Array.isArray(requiredScope) ? requiredScope : [requiredScope];
    const matchesScope = requiredScopes.some((scope) => hasScope(key, scope));

    if (!matchesScope) {
      response.status(403).json({
        message: `Missing required scope: ${requiredScopes.join(" or ")}`,
      });
      return;
    }

    request.apiKey = key;
    next();
  };
}
