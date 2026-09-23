import { useState, useEffect } from 'react';
import { useSocket } from '../context/SocketContext';
import { followAPI } from '../services/api';

export const useFollow = (userId) => {
  const { socket } = useSocket();
  const [isFollowing, setIsFollowing] = useState(false);
  const [followerCount, setFollowerCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Fetch follow status and counts on mount
  useEffect(() => {
    const fetchFollowStatus = async () => {
      try {
        setLoading(true);
        const [statusRes, countsRes] = await Promise.all([
          followAPI.getFollowStatus(userId),
          followAPI.getFollowerCounts(userId)
        ]);

        if (statusRes.data?.data) {
          setIsFollowing(statusRes.data.data.isFollowing);
        }
        if (countsRes.data?.data) {
          setFollowerCount(countsRes.data.data.followers);
          setFollowingCount(countsRes.data.data.following);
        }
      } catch (err) {
        console.error('Error fetching follow status:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    if (userId) {
      fetchFollowStatus();
    }
  }, [userId]);

  // Listen for real-time follow updates
  useEffect(() => {
    if (!socket) return;

    const onFollowNew = (data) => {
      if (data.followedUserId === userId) {
        setFollowerCount(prev => prev + 1);
      }
    };

    const onFollowRemoved = (data) => {
      if (data.followedUserId === userId) {
        setFollowerCount(prev => Math.max(0, prev - 1));
      }
    };

    socket.on('follow:new', onFollowNew);
    socket.on('follow:removed', onFollowRemoved);

    // Deregister only these specific handlers — socket.off(event) with no
    // handler argument would remove every listener for that event on the
    // shared socket, including ones registered by other useFollow instances
    // mounted at the same time (e.g. multiple follow buttons on one page).
    return () => {
      socket.off('follow:new', onFollowNew);
      socket.off('follow:removed', onFollowRemoved);
    };
  }, [socket, userId]);

  const followUser = async () => {
    try {
      setLoading(true);
      const res = await followAPI.followUser(userId);
      if (res.data?.success) {
        setIsFollowing(true);
        setFollowerCount(prev => prev + 1);

        // Emit Socket.IO event for real-time updates
        if (socket) {
          socket.emit('follow:action', { followedUserId: userId, action: 'follow' });
        }
      }
    } catch (err) {
      console.error('Error following user:', err);
      setError(err.response?.data?.error || 'Failed to follow user');
    } finally {
      setLoading(false);
    }
  };

  const unfollowUser = async () => {
    try {
      setLoading(true);
      const res = await followAPI.unfollowUser(userId);
      if (res.data?.success) {
        setIsFollowing(false);
        setFollowerCount(prev => Math.max(0, prev - 1));

        // Emit Socket.IO event for real-time updates
        if (socket) {
          socket.emit('follow:action', { followedUserId: userId, action: 'unfollow' });
        }
      }
    } catch (err) {
      console.error('Error unfollowing user:', err);
      setError(err.response?.data?.error || 'Failed to unfollow user');
    } finally {
      setLoading(false);
    }
  };

  const toggleFollow = async () => {
    if (isFollowing) {
      await unfollowUser();
    } else {
      await followUser();
    }
  };

  return {
    isFollowing,
    followerCount,
    followingCount,
    loading,
    error,
    followUser,
    unfollowUser,
    toggleFollow
  };
};
