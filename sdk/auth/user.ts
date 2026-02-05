// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import type { Session, User, UserInfo } from "./types.ts";
import { getSessionFromCookie } from "./session.ts";
// BaseUser type - inline definition to avoid cross-package dependency
interface BaseUser {
  id: string;
  displayName: string;
  email?: string;
  profilePicture?: string;
}

/**
 * Create or get user from OAuth provider info
 * Supports account linking via OAuth provider mappings
 * Copied from todo/src/app/user.ts exactly
 */
export async function createOrGetUser(
  kv: Deno.Kv,
  provider: "github" | "google",
  providerId: string,
  avatar_url: string,
  name?: string,
  email?: string,
  githubLogin?: string,
): Promise<User> {
  // Check for existing OAuth mapping
  const oauthMappingResult = await kv.get<string>([
    "oauth",
    provider,
    providerId,
  ]);

  if (oauthMappingResult.value) {
    // User exists, get and update their info
    const userId = oauthMappingResult.value;
    const userResult = await kv.get<User>(["user", userId]);

    if (userResult.value) {
      // Update user info
      const updatedUser: User = {
        ...userResult.value,
        avatar_url,
        name: name || userResult.value.name,
        email: email || userResult.value.email,
        ...(provider === "github" && { githubOAuthId: providerId }),
        ...(provider === "github" && githubLogin && { githubLogin }),
        ...(provider === "google" && { googleOAuthId: providerId }),
      };

      await kv.set(["user", userId], updatedUser);
      return updatedUser;
    }
  }

  // No existing mapping, create new user
  const userId = crypto.randomUUID();
  const newUser: User = {
    id: userId,
    avatar_url,
    name,
    email,
    ...(provider === "github" && { githubOAuthId: providerId }),
    ...(provider === "github" && githubLogin && { githubLogin }),
    ...(provider === "google" && { googleOAuthId: providerId }),
  };

  // Store user record and OAuth mapping
  await Promise.all([
    kv.set(["user", userId], newUser),
    kv.set(["oauth", provider, providerId], userId),
  ]);

  return newUser;
}

/**
 * Helper to get user ID from request (from session cookie)
 * Copied from todo/src/app/user.ts exactly
 */
export async function getUserIdFromRequest(
  req: Request,
  kv: Deno.Kv,
): Promise<string | null> {
  const cookie = req.headers.get("cookie");
  if (!cookie) return null;

  const sessionId = cookie
    .split(";")
    .find((c) => c.trim().startsWith("session="))
    ?.split("=")[1];

  if (!sessionId) return null;

  try {
    const result = await kv.get<Session>(["session", sessionId]);
    const session = result.value;

    if (!session || session.expiresAt < Date.now()) {
      return null;
    }

    return String(session.userId);
  } catch (error) {
    console.error("Error getting session:", error);
    return null;
  }
}

/**
 * Convert SDK User to base user format for search results
 * Based on todo's todoUserToBase pattern
 */
function userToBaseUser(user: User): BaseUser {
  return {
    id: String(user.id),
    displayName: user.name || user.email || user.id,
    email: user.email,
    profilePicture: user.avatar_url,
  };
}

/**
 * Handles user search endpoint
 * GET /api/users/search?q={query}
 * Requires authentication via session cookie
 * Copied from todo/src/app/user.ts exactly
 */
export async function handleUserSearch(
  req: Request,
  kv: Deno.Kv,
): Promise<Response> {
  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  const userId = await getUserIdFromRequest(req, kv);
  if (!userId) {
    return new Response("Authentication required", { status: 401 });
  }

  const url = new URL(req.url);
  const query = url.searchParams.get("q") || "";
  const limit = parseInt(url.searchParams.get("limit") || "50", 10);

  if (query.length < 2) {
    return new Response(JSON.stringify({ value: [], total: 0 }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const queryLower = query.toLowerCase();
    const users: User[] = [];

    // Search through user records directly instead of sessions
    // This is more efficient and doesn't include expired sessions
    const userIter = kv.list<User>({ prefix: ["user"] });

    for await (const entry of userIter) {
      const user = entry.value;
      if (!user) continue;

      const matchesName = user.name?.toLowerCase().includes(queryLower);
      const matchesEmail = user.email?.toLowerCase().includes(queryLower);
      const matchesGitHubLogin = user.githubLogin?.toLowerCase().includes(
        queryLower,
      );

      if (matchesName || matchesEmail || matchesGitHubLogin) {
        // Exclude current user
        if (String(user.id) !== userId) {
          users.push(user);
        }
      }

      if (users.length >= limit) break;
    }

    // Convert to base user format
    const baseUsers = users.map(userToBaseUser);

    return new Response(
      JSON.stringify({ value: baseUsers, total: baseUsers.length }),
      {
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("Error searching users:", error);
    return new Response(JSON.stringify({ error: "Failed to search users" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

/**
 * Handles friend management endpoints
 * GET /api/friends - Get current user's friends list
 * POST /api/friends/{friendId} - Send friend request / add friend
 * DELETE /api/friends/{friendId} - Remove friend
 * GET /api/friends/requests - Get pending friend requests
 * PUT /api/friends/requests/{requestId}/accept - Accept friend request
 * PUT /api/friends/requests/{requestId}/reject - Reject friend request
 * Copied from todo/src/app/user.ts exactly
 */
export async function handleFriends(
  req: Request,
  kv: Deno.Kv,
): Promise<Response> {
  const userId = await getUserIdFromRequest(req, kv);
  if (!userId) {
    return new Response("Authentication required", { status: 401 });
  }

  const url = new URL(req.url);
  const pathname = url.pathname;

  // GET /api/friends - Get friends list
  if (req.method === "GET" && pathname === "/api/friends") {
    try {
      const url = new URL(req.url);
      const statusFilter = url.searchParams.get("status") || "accepted"; // Default to accepted

      const friends: Array<
        {
          userId: string;
          friendId: string;
          status: string;
          createdAt: string;
          presence?: number;
        }
      > = [];
      const iter = kv.list({ prefix: ["friends", userId] });

      for await (const entry of iter) {
        const friendData = entry.value as {
          status: string;
          createdAt: string;
          presence?: number;
        };
        // Filter by status (default to accepted only)
        if (statusFilter === "all" || friendData.status === statusFilter) {
          friends.push({
            userId,
            friendId: entry.key[2] as string,
            status: friendData.status,
            createdAt: friendData.createdAt,
            presence: friendData.presence,
          });
        }
      }

      // Get friend user details using direct user lookups (much more efficient)
      const friendsWithDetails = await Promise.all(
        friends.map(async (f) => {
          // Look up user directly instead of iterating sessions
          const userResult = await kv.get<User>(["user", f.friendId]);
          const friendUser = userResult.value;

          return {
            ...f,
            friend: friendUser ? userToBaseUser(friendUser) : null,
          };
        }),
      );

      return new Response(JSON.stringify({ value: friendsWithDetails }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Error getting friends:", error);
      return new Response(JSON.stringify({ error: "Failed to get friends" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // GET /api/friends/requests - Get pending friend requests
  if (req.method === "GET" && pathname === "/api/friends/requests") {
    try {
      const requests: Array<
        {
          id: string;
          fromUserId: string;
          toUserId: string;
          status: string;
          createdAt: string;
        }
      > = [];
      const iter = kv.list({ prefix: ["friend_requests", userId] });

      for await (const entry of iter) {
        const requestData = entry.value as {
          fromUserId: string;
          toUserId: string;
          status: string;
          createdAt: string;
        };
        if (requestData.status === "pending") {
          requests.push({
            id: entry.key[2] as string,
            ...requestData,
          });
        }
      }

      // Get requester user details using direct user lookups (much more efficient)
      const requestsWithDetails = await Promise.all(
        requests.map(async (r) => {
          // Look up user directly instead of iterating sessions
          const userResult = await kv.get<User>(["user", r.fromUserId]);
          const requester = userResult.value;

          return {
            ...r,
            requester: requester ? userToBaseUser(requester) : null,
          };
        }),
      );

      return new Response(JSON.stringify({ value: requestsWithDetails }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Error getting friend requests:", error);
      return new Response(
        JSON.stringify({ error: "Failed to get friend requests" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  }

  // POST /api/friends/{friendId} - Send friend request
  if (req.method === "POST" && pathname.startsWith("/api/friends/")) {
    const friendId = pathname.split("/").pop();
    if (!friendId || friendId === "requests") {
      return new Response("Friend ID is required", { status: 400 });
    }

    if (userId === friendId) {
      return new Response("Cannot add yourself as a friend", { status: 400 });
    }

    try {
      // Verify friend user exists
      const friendUserResult = await kv.get<User>(["user", friendId]);
      if (!friendUserResult.value) {
        return new Response(JSON.stringify({ error: "User not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Check if friendship already exists (both directions)
      const [existingFriendResult, reverseFriendResult] = await Promise.all([
        kv.get<{ status: string; createdAt: string }>([
          "friends",
          userId,
          friendId,
        ]),
        kv.get<{ status: string; createdAt: string }>([
          "friends",
          friendId,
          userId,
        ]),
      ]);

      if (existingFriendResult.value || reverseFriendResult.value) {
        const existingStatus = existingFriendResult.value?.status ||
          reverseFriendResult.value?.status;
        return new Response(
          JSON.stringify({
            error: existingStatus === "accepted"
              ? "Friendship already exists"
              : "Friend request already pending",
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      // Check if friend request already exists in both directions
      // Check requests where current user is recipient
      const requestsToUser = kv.list({ prefix: ["friend_requests", userId] });
      // Check requests where friend is recipient (to catch requests we sent)
      const requestsToFriend = kv.list({
        prefix: ["friend_requests", friendId],
      });

      let existingRequest = null;

      // Check requests to current user
      for await (const entry of requestsToUser) {
        const requestData = entry.value as {
          fromUserId: string;
          toUserId: string;
          status: string;
        };
        if (
          requestData.fromUserId === friendId &&
          requestData.toUserId === userId &&
          requestData.status === "pending"
        ) {
          existingRequest = entry;
          break;
        }
      }

      // Check requests to friend (requests we sent)
      if (!existingRequest) {
        for await (const entry of requestsToFriend) {
          const requestData = entry.value as {
            fromUserId: string;
            toUserId: string;
            status: string;
          };
          if (
            requestData.fromUserId === userId &&
            requestData.toUserId === friendId &&
            requestData.status === "pending"
          ) {
            existingRequest = entry;
            break;
          }
        }
      }

      if (existingRequest) {
        return new Response(
          JSON.stringify({ error: "Friend request already pending" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      // Create friend request
      const requestId = crypto.randomUUID();
      const requestData = {
        fromUserId: userId,
        toUserId: friendId,
        status: "pending",
        createdAt: new Date().toISOString(),
      };

      await kv.set(["friend_requests", friendId, requestId], requestData);

      return new Response(JSON.stringify({ success: true, requestId }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Error sending friend request:", error);
      return new Response(
        JSON.stringify({ error: "Failed to send friend request" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  }

  // DELETE /api/friends/{friendId} - Remove friend
  if (req.method === "DELETE" && pathname.startsWith("/api/friends/")) {
    const friendId = pathname.split("/").pop();
    if (!friendId || friendId === "requests") {
      return new Response("Friend ID is required", { status: 400 });
    }

    if (userId === friendId) {
      return new Response(
        JSON.stringify({ error: "Cannot remove yourself as a friend" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    try {
      // Check if friendship exists
      const friendshipResult = await kv.get(["friends", userId, friendId]);
      if (!friendshipResult.value) {
        return new Response(JSON.stringify({ error: "Friendship not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Delete friendship in both directions
      await Promise.all([
        kv.delete(["friends", userId, friendId]),
        kv.delete(["friends", friendId, userId]),
      ]);

      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Error removing friend:", error);
      return new Response(
        JSON.stringify({ error: "Failed to remove friend" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  }

  // PUT /api/friends/requests/{requestId}/accept - Accept friend request
  if (req.method === "PUT" && pathname.includes("/accept")) {
    const requestId = pathname.split("/").pop();
    if (!requestId) {
      return new Response("Request ID is required", { status: 400 });
    }

    try {
      const requestResult = await kv.get([
        "friend_requests",
        userId,
        requestId,
      ]);
      if (!requestResult.value) {
        return new Response(
          JSON.stringify({ error: "Friend request not found" }),
          {
            status: 404,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      const requestData = requestResult.value as {
        fromUserId: string;
        toUserId: string;
        status: string;
      };

      // Validate request is pending
      if (requestData.status !== "pending") {
        return new Response(
          JSON.stringify({
            error: requestData.status === "accepted"
              ? "Friend request has already been accepted"
              : "Friend request is not pending",
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      // Validate request is to current user
      if (requestData.toUserId !== userId) {
        return new Response(
          JSON.stringify({
            error: "Unauthorized: This request is not for you",
          }),
          {
            status: 403,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      const fromUserId = requestData.fromUserId;

      // Check if friendship already exists (race condition protection)
      const existingFriendship = await kv.get<
        { status: string; createdAt: string }
      >([
        "friends",
        userId,
        fromUserId,
      ]);
      if (existingFriendship.value?.status === "accepted") {
        // Friendship already exists, just update request status
        await kv.set(["friend_requests", userId, requestId], {
          ...requestData,
          status: "accepted",
          updatedAt: new Date().toISOString(),
        });
        return new Response(
          JSON.stringify({
            success: true,
            message: "Friendship already exists",
          }),
          {
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      const now = new Date().toISOString();

      // Create friendship in both directions
      await Promise.all([
        kv.set(["friends", userId, fromUserId], {
          status: "accepted",
          createdAt: now,
        }),
        kv.set(["friends", fromUserId, userId], {
          status: "accepted",
          createdAt: now,
        }),
        // Update request status
        kv.set(["friend_requests", userId, requestId], {
          ...requestData,
          status: "accepted",
          updatedAt: now,
        }),
      ]);

      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Error accepting friend request:", error);
      return new Response(
        JSON.stringify({ error: "Failed to accept friend request" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  }

  // PUT /api/friends/requests/{requestId}/reject - Reject friend request
  if (req.method === "PUT" && pathname.includes("/reject")) {
    const requestId = pathname.split("/").pop();
    if (!requestId) {
      return new Response("Request ID is required", { status: 400 });
    }

    try {
      const requestResult = await kv.get([
        "friend_requests",
        userId,
        requestId,
      ]);
      if (!requestResult.value) {
        return new Response(
          JSON.stringify({ error: "Friend request not found" }),
          {
            status: 404,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      const requestData = requestResult.value as {
        fromUserId: string;
        toUserId: string;
        status: string;
      };

      // Validate request is pending
      if (requestData.status !== "pending") {
        return new Response(
          JSON.stringify({
            error: requestData.status === "rejected"
              ? "Friend request has already been rejected"
              : requestData.status === "accepted"
              ? "Friend request has already been accepted"
              : "Friend request is not pending",
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      // Validate request is to current user
      if (requestData.toUserId !== userId) {
        return new Response(
          JSON.stringify({
            error: "Unauthorized: This request is not for you",
          }),
          {
            status: 403,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      // Update request status to rejected
      await kv.set(["friend_requests", userId, requestId], {
        ...requestData,
        status: "rejected",
        updatedAt: new Date().toISOString(),
      });

      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Error rejecting friend request:", error);
      return new Response(
        JSON.stringify({ error: "Failed to reject friend request" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  }

  return new Response("Method not allowed", { status: 405 });
}

/**
 * Get user by ID
 * GET /api/users/{id}
 * Requires authentication via session cookie
 */
export async function handleGetUserById(
  req: Request,
  kv: Deno.Kv,
  userId: string,
): Promise<Response> {
  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Verify requester is authenticated
  const requesterId = await getUserIdFromRequest(req, kv);
  if (!requesterId) {
    return new Response("Authentication required", { status: 401 });
  }

  try {
    const userResult = await kv.get<User>(["user", userId]);
    if (!userResult.value) {
      return new Response(JSON.stringify({ error: "User not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Convert to base user format
    const baseUser = userToBaseUser(userResult.value);

    return new Response(JSON.stringify(baseUser), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error getting user by ID:", error);
    return new Response(JSON.stringify({ error: "Failed to get user" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

/**
 * Main user handler
 * Handles /api/users/search, /api/users/{id}, and /api/friends/* endpoints
 * Copied from todo/src/app/user.ts exactly
 */
export async function userHandler(
  req: Request,
  kv: Deno.Kv,
): Promise<Response> {
  const url = new URL(req.url);
  const pathname = url.pathname;

  // Handle friend endpoints
  if (pathname.startsWith("/api/friends")) {
    return await handleFriends(req, kv);
  }

  // Handle user search endpoint
  if (pathname === "/api/users/search") {
    return await handleUserSearch(req, kv);
  }

  // Handle get user by ID endpoint
  // /api/users/{userId}
  if (pathname.startsWith("/api/users/") && pathname !== "/api/users/search") {
    const userId = pathname.split("/").pop();
    if (userId) {
      return await handleGetUserById(req, kv, userId);
    }
  }

  return new Response("Not found", { status: 404 });
}

/**
 * Get current user info
 */
export async function handleGetUser(
  req: Request,
  kv: Deno.Kv,
): Promise<Response> {
  const cookie = req.headers.get("cookie");
  const session = await getSessionFromCookie(cookie, kv);

  if (!session) {
    return new Response(JSON.stringify({ error: "Not authenticated" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const userInfo: UserInfo = {
    userId: session.userId,
    userName: session.name || session.email || session.userId,
    avatarUrl: session.avatar_url,
    name: session.name,
    email: session.email,
  };

  return new Response(JSON.stringify(userInfo), {
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Handle logout
 */
export async function handleLogout(
  req: Request,
  kv: Deno.Kv,
): Promise<Response> {
  const cookie = req.headers.get("cookie");
  const sessionId = cookie
    ?.split(";")
    .find((c) => c.trim().startsWith("session="))
    ?.split("=")[1];

  if (sessionId) {
    await kv.delete(["session", sessionId]);
  }

  const response = new Response(JSON.stringify({ success: true }), {
    headers: { "Content-Type": "application/json" },
  });

  // Clear session cookie
  response.headers.set("Set-Cookie", "session=; Path=/; Max-Age=0; HttpOnly");

  return response;
}
