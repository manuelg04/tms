import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const list = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("notifications"),
      _creationTime: v.number(),
      title: v.string(),
      body: v.string(),
      status: v.union(v.literal("unread"), v.literal("read")),
      createdAt: v.number()
    })
  ),
  handler: async (ctx) => {
    const notifications = await ctx.db.query("notifications").order("desc").take(30);
    return notifications.map((notification) => ({
      _id: notification._id,
      _creationTime: notification._creationTime,
      title: notification.title,
      body: notification.body,
      status: notification.status,
      createdAt: notification.createdAt
    }));
  }
});

export const unreadCount = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_status", (q) => q.eq("status", "unread"))
      .take(100);
    return unread.length;
  }
});

export const markAllRead = mutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_status", (q) => q.eq("status", "unread"))
      .take(200);

    for (const notification of unread) {
      await ctx.db.patch(notification._id, { status: "read" });
    }

    return unread.length;
  }
});
