const NewsLike = require("../models/NewsLike");
const Announcement = require("../models/Announcement");

// Like a news announcement
exports.likeNews = async (req, res) => {
  try {
    const { newsId } = req.params;
    const userId = req.user.id;

    const news = await Announcement.findOne({ _id: newsId, isActive: true });
    if (!news) {
      return res.status(404).json({ error: "Announcement not found" });
    }

    const existingLike = await NewsLike.findOne({ userId, newsId });
    if (existingLike) {
      const likeCount = await NewsLike.countDocuments({ newsId });
      return res.status(200).json({
        success: true,
        message: "Announcement already liked",
        data: { newsId, likeCount, isLiked: true },
      });
    }

    await NewsLike.create({ userId, newsId });
    const likeCount = await NewsLike.countDocuments({ newsId });

    return res.status(201).json({
      success: true,
      message: "Announcement liked successfully",
      data: { newsId, likeCount, isLiked: true },
    });
  } catch (error) {
    console.error("Like news error:", error);
    return res.status(500).json({ error: "Failed to like announcement" });
  }
};

// Unlike a news announcement
exports.unlikeNews = async (req, res) => {
  try {
    const { newsId } = req.params;
    const userId = req.user.id;

    await NewsLike.findOneAndDelete({ userId, newsId });
    const likeCount = await NewsLike.countDocuments({ newsId });

    return res.json({
      success: true,
      message: "Announcement unliked successfully",
      data: { newsId, likeCount, isLiked: false },
    });
  } catch (error) {
    console.error("Unlike news error:", error);
    return res.status(500).json({ error: "Failed to unlike announcement" });
  }
};

// Get all liked announcements for the current user (paginated)
exports.getLikedNews = async (req, res) => {
  try {
    const userId = req.user.id;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 60);
    const skip = (page - 1) * limit;

    const totalLikes = await NewsLike.countDocuments({ userId });

    const likes = await NewsLike.find({ userId })
      .populate({
        path: "newsId",
        select: "title content category imageUrl publishedAt createdAt isActive author",
        populate: { path: "author", select: "name email" },
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    // Drop likes whose announcement was deleted or unpublished
    const items = likes
      .filter((like) => like.newsId && like.newsId.isActive)
      .map((like) => ({
        ...like.newsId.toObject(),
        likedAt: like.createdAt,
      }));

    return res.json({
      success: true,
      data: items,
      pagination: {
        total: totalLikes,
        page,
        limit,
        pages: Math.max(Math.ceil(totalLikes / limit), 1),
      },
    });
  } catch (error) {
    console.error("Get liked news error:", error);
    return res.status(500).json({ error: "Failed to fetch liked announcements" });
  }
};

// Get like status + count for a single announcement
exports.getNewsLikeStatus = async (req, res) => {
  try {
    const { newsId } = req.params;
    const userId = req.user.id;

    const [like, likeCount] = await Promise.all([
      NewsLike.findOne({ userId, newsId }),
      NewsLike.countDocuments({ newsId }),
    ]);

    return res.json({
      success: true,
      data: { isLiked: Boolean(like), likeCount },
    });
  } catch (error) {
    console.error("Get news like status error:", error);
    return res.status(500).json({ error: "Failed to fetch like status" });
  }
};
