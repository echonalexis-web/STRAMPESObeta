import React from "react";
import { FaHeart, FaRegHeart, FaBookmark } from "react-icons/fa";
import { useJobLike } from "../hooks/useJobLike";

export default function JobFavoriteButton({ jobId, hideCount = false, variant = "heart" }) {
  const { isLiked, likeCount, loading, toggleLike } = useJobLike(jobId);
  const icon = variant === "ribbon" ? <FaBookmark /> : isLiked ? <FaHeart /> : <FaRegHeart />;

  return (
    <button
      type="button"
      className={`btn-favorite-icon ${isLiked ? "btn-favorite-active" : ""}`}
      onClick={toggleLike}
      disabled={loading}
      aria-label={isLiked ? "Remove from favorites" : "Add to favorites"}
      title={isLiked ? "Remove from favorites" : "Add to favorites"}
    >
      {icon}
      {!hideCount ? <span className="favorite-count">{Number(likeCount || 0)}</span> : null}
    </button>
  );
}
