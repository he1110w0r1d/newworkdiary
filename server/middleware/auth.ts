import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { findApiKey, type ApiKeyRecord, hasScope } from "../services/apiKeys";
import { findUserById } from "../repositories/postgresRepository";

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: number;
        username: string;
        role?: string;
      };
      apiKey?: ApiKeyRecord;
    }
  }
}

export const JWT_SECRET = process.env.JWT_SECRET ?? "default_workdiary_jwt_secret_key_change_me_in_production";

export async function requireAuth(request: Request, response: Response, next: NextFunction) {
  // 如果数据库没配置且没有在 Postgres 模式下运行，允许匿名通过（作为 DEMO 体验）
  if (!process.env.DATABASE_URL) {
    request.user = { id: 1, username: "demo" };
    next();
    return;
  }

  const authHeader = request.header("Authorization");
  const rawKey = request.header("X-API-Key");

  if (authHeader) {
    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0] !== "Bearer") {
      response.status(401).json({
        message: "Authorization header must be Bearer <token>",
      });
      return;
    }

    const token = parts[1];

    try {
      const decoded = jwt.verify(token, JWT_SECRET) as { id: number; username: string; role?: string };
      request.user = decoded;
      next();
    } catch (error) {
      response.status(401).json({
        message: "Invalid or expired token",
      });
    }
    return;
  }

  if (rawKey) {
    try {
      const key = await findApiKey(rawKey);
      if (!key) {
        response.status(401).json({
          message: "Invalid or expired API key",
        });
        return;
      }
      request.user = { id: key.user_id, username: "agent" };
      request.apiKey = key;
      next();
    } catch (error) {
      response.status(500).json({
        message: "Authentication error",
      });
    }
    return;
  }

  response.status(401).json({
    message: "Authorization header or X-API-Key header is required",
  });
}

export function requireScope(requiredScope: string | string[]) {
  return (request: Request, response: Response, next: NextFunction) => {
    if (request.apiKey) {
      const requiredScopes = Array.isArray(requiredScope) ? requiredScope : [requiredScope];
      const match = requiredScopes.some(scope => hasScope(request.apiKey!, scope));
      if (!match) {
        response.status(403).json({
          message: `Missing required scope: ${requiredScopes.join(" or ")}`,
        });
        return;
      }
    }
    next();
  };
}

export async function requireAdmin(request: Request, response: Response, next: NextFunction) {
  if (!request.user?.id) {
    response.status(401).json({ message: "Admin authentication required" });
    return;
  }

  try {
    const user = await findUserById(request.user.id);
    if (!user || user.status !== "active" || user.role !== "admin") {
      response.status(403).json({ message: "Admin permission required" });
      return;
    }
    request.user = { id: user.id, username: user.username, role: user.role };
    next();
  } catch (error) {
    response.status(500).json({ message: "Admin authentication error" });
  }
}
