import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireActor } from "./model/access";

export const list = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("notifications"),
      _creationTime: v.number(),
      title: v.string(),
      body: v.string(),
      status: v.union(v.literal("unread"), v.literal("read")),
      category: v.optional(v.union(v.literal("rejection"), v.literal("reconciliation"), v.literal("fulfillment"), v.literal("evidence"))),
      actionLabel: v.optional(v.string()),
      actionHref: v.optional(v.string()),
      createdAt: v.number()
    })
  ),
  handler: async (ctx) => {
    const actor = await requireActor(ctx);
    const notifications = (await ctx.db
      .query("notifications")
      .withIndex("by_organization_and_created_at", (q) => q.eq("organizationId", actor.organizationId))
      .order("desc")
      .take(200))
      .filter((notification) => !notification.userId || notification.userId === actor._id)
      .slice(0, 30);
    return notifications.map((notification) => ({
      _id: notification._id,
      _creationTime: notification._creationTime,
      title: notification.title,
      body: notification.body,
      status: notification.status,
      category: notification.category,
      actionLabel: notification.actionLabel,
      actionHref: notification.actionHref,
      createdAt: notification.createdAt
    }));
  }
});

export const unreadCount = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const actor = await requireActor(ctx);
    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_organization_and_status", (q) => q.eq("organizationId", actor.organizationId).eq("status", "unread"))
      .take(100);
    return unread.filter((notification) => !notification.userId || notification.userId === actor._id).length;
  }
});

export const markAllRead = mutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const actor = await requireActor(ctx);
    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_organization_and_status", (q) => q.eq("organizationId", actor.organizationId).eq("status", "unread"))
      .take(200);

    const scoped = unread.filter((notification) => !notification.userId || notification.userId === actor._id);
    for (const notification of scoped) {
      await ctx.db.patch(notification._id, { status: "read" });
    }

    return scoped.length;
  }
});
