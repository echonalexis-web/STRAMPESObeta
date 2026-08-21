import { useCallback, useEffect, useMemo, useState } from "react";
import { notificationAPI } from "../services/api";
import { useSocket } from "../context/SocketContext";

export const useNotifications = ({ initialLimit = 20, autoLoad = true } = {}) => {
  const { socket, isConnected } = useSocket();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const fetchNotifications = useCallback(async (params = {}) => {
    setLoading(true);
    try {
      const { data } = await notificationAPI.getNotifications({
        page: 1,
        limit: initialLimit,
        ...params,
      });
      const items = Array.isArray(data?.items) ? data.items : [];
      setNotifications(items);
      setUnreadCount(Number(data?.unreadCount || 0));
      return items;
    } catch (error) {
      return [];
    } finally {
      setLoading(false);
    }
  }, [initialLimit]);

  const fetchUnreadCount = useCallback(async () => {
    try {
      const { data } = await notificationAPI.getUnreadCount();
      setUnreadCount(Number(data?.count || 0));
      return Number(data?.count || 0);
    } catch (error) {
      return 0;
    }
  }, []);

  const markAsRead = useCallback(async (notificationId) => {
    if (!notificationId) return;
    try {
      await notificationAPI.markAsRead(notificationId);
      setNotifications((prev) =>
        prev.map((item) =>
          String(item._id) === String(notificationId)
            ? { ...item, isRead: true, readAt: new Date().toISOString() }
            : item
        )
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (error) {
      return;
    }
  }, []);

  const markAllAsRead = useCallback(async () => {
    try {
      await notificationAPI.markAllAsRead();
      setNotifications((prev) =>
        prev.map((item) => ({
          ...item,
          isRead: true,
          readAt: item.readAt || new Date().toISOString(),
        }))
      );
      setUnreadCount(0);
    } catch (error) {
      return;
    }
  }, []);

  const deleteNotification = useCallback(async (notificationId) => {
    try {
      await notificationAPI.deleteNotification(notificationId);
      setNotifications((prev) => prev.filter((item) => String(item._id) !== String(notificationId)));
    } catch (error) {
      return;
    }
  }, []);

  useEffect(() => {
    if (!autoLoad) return;
    fetchNotifications();
  }, [autoLoad, fetchNotifications]);

  useEffect(() => {
    if (!socket || !isConnected) return undefined;

    const onNewNotification = (incoming) => {
      if (!incoming?._id) return;
      setNotifications((prev) => [incoming, ...prev.filter((item) => String(item._id) !== String(incoming._id))]);
      setUnreadCount((prev) => prev + (incoming.isRead ? 0 : 1));
    };

    const onUpdatedNotification = (incoming) => {
      if (!incoming?._id) return;
      setNotifications((prev) =>
        prev.map((item) =>
          String(item._id) === String(incoming._id)
            ? { ...item, ...incoming }
            : item
        )
      );
      fetchUnreadCount();
    };

    const onAllRead = () => {
      setNotifications((prev) =>
        prev.map((item) => ({
          ...item,
          isRead: true,
          readAt: item.readAt || new Date().toISOString(),
        }))
      );
      setUnreadCount(0);
    };

    const onDeletedNotification = (incoming) => {
      if (!incoming?._id) return;
      setNotifications((prev) => prev.filter((item) => String(item._id) !== String(incoming._id)));
      fetchUnreadCount();
    };

    socket.on("notification:new", onNewNotification);
    socket.on("notification:updated", onUpdatedNotification);
    socket.on("notification:all-read", onAllRead);
    socket.on("notification:deleted", onDeletedNotification);

    return () => {
      socket.off("notification:new", onNewNotification);
      socket.off("notification:updated", onUpdatedNotification);
      socket.off("notification:all-read", onAllRead);
      socket.off("notification:deleted", onDeletedNotification);
    };
  }, [socket, isConnected, fetchUnreadCount]);

  const value = useMemo(() => ({
    notifications,
    loading,
    unreadCount,
    fetchNotifications,
    fetchUnreadCount,
    markAsRead,
    markAllAsRead,
    deleteNotification,
  }), [notifications, loading, unreadCount, fetchNotifications, fetchUnreadCount, markAsRead, markAllAsRead, deleteNotification]);

  return value;
};
