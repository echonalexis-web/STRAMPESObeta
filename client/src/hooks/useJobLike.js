import { useState, useEffect } from 'react';
import { useSocket } from '../context/SocketContext';
import { jobLikeAPI } from '../services/api';

export const useJobLike = (jobId) => {
  const { socket } = useSocket();
  const [isLiked, setIsLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Fetch like status and count on mount
  useEffect(() => {
    const fetchLikeStatus = async () => {
      try {
        setLoading(true);
        const res = await jobLikeAPI.getJobLikeStatus(jobId);
        
        if (res.data?.data) {
          setIsLiked(res.data.data.isLiked);
          setLikeCount(res.data.data.likeCount);
        }
      } catch (err) {
        console.error('Error fetching like status:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    if (jobId) {
      fetchLikeStatus();
    }
  }, [jobId]);

  // Listen for real-time like updates
  useEffect(() => {
    if (!socket) return;

    const onJobLiked = (data) => {
      if (data.jobId === jobId) {
        setLikeCount(prev => data.totalLikes ?? prev);
      }
    };

    const onJobUnliked = (data) => {
      if (data.jobId === jobId) {
        setLikeCount(prev => data.totalLikes ?? Math.max(0, prev - 1));
      }
    };

    socket.on('job:liked', onJobLiked);
    socket.on('job:unliked', onJobUnliked);

    // Deregister only these specific handlers — socket.off(event) with no
    // handler argument would remove every listener for that event on the
    // shared socket, including ones registered by other useJobLike instances
    // mounted at the same time (e.g. multiple job cards on one page).
    return () => {
      socket.off('job:liked', onJobLiked);
      socket.off('job:unliked', onJobUnliked);
    };
  }, [socket, jobId]);

  const likeJob = async () => {
    try {
      setLoading(true);
      const res = await jobLikeAPI.likeJob(jobId);
      
      if (res.data?.success) {
        setIsLiked(true);
        setLikeCount(res.data.data?.likeCount || likeCount + 1);

        // Emit Socket.IO event for real-time updates
        if (socket) {
          socket.emit('job:like-action', { jobId, action: 'like', totalLikes: res.data.data?.likeCount });
        }
      }
    } catch (err) {
      console.error('Error liking job:', err);
      setError(err.response?.data?.error || 'Failed to like job');
    } finally {
      setLoading(false);
    }
  };

  const unlikeJob = async () => {
    try {
      setLoading(true);
      const res = await jobLikeAPI.unlikeJob(jobId);
      
      if (res.data?.success) {
        setIsLiked(false);
        setLikeCount(res.data.data?.likeCount || Math.max(0, likeCount - 1));

        // Emit Socket.IO event for real-time updates
        if (socket) {
          socket.emit('job:like-action', { jobId, action: 'unlike', totalLikes: res.data.data?.likeCount });
        }
      }
    } catch (err) {
      console.error('Error unliking job:', err);
      setError(err.response?.data?.error || 'Failed to unlike job');
    } finally {
      setLoading(false);
    }
  };

  const toggleLike = async () => {
    if (isLiked) {
      await unlikeJob();
    } else {
      await likeJob();
    }
  };

  return {
    isLiked,
    likeCount,
    loading,
    error,
    likeJob,
    unlikeJob,
    toggleLike
  };
};
