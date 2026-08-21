const Follow = require("../models/Follow");
const User = require("../models/User");
const { createNotificationForUser } = require("../services/notificationService");

// Follow a user
exports.followUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const followerId = req.user.id;

    // Cannot follow self
    if (followerId === userId) {
      return res.status(400).json({ error: "You cannot follow yourself" });
    }

    // Check if target user exists
    const targetUser = await User.findById(userId);
    if (!targetUser) {
      return res.status(404).json({ error: "User not found" });
    }

    // Check if already following
    const existingFollow = await Follow.findOne({ follower: followerId, following: userId });
    if (existingFollow) {
      return res.status(400).json({ error: "Already following this user" });
    }

    // Create follow
    const follow = await Follow.create({ follower: followerId, following: userId });

    // Get follower details for notification
    const followerUser = await User.findById(followerId).select("name email");
    const followerName = followerUser?.name || followerUser?.email || "Someone";
    const io = req.app.get("io");

    // Send notification to followed user
    await createNotificationForUser({
      recipientId: userId,
      actorId: followerId,
      type: "system",
      title: `${followerName} followed you`,
      message: `${followerName} is now following you`,
      relatedEntityType: "user",
      relatedEntityId: followerId,
      actionUrl: `/profile/${followerId}`,
      metadata: { followerName },
      io,
    });

    res.status(201).json({
      success: true,
      message: "User followed successfully",
      data: follow
    });
  } catch (error) {
    console.error("Follow error:", error);
    res.status(500).json({ error: "Failed to follow user" });
  }
};

// Unfollow a user
exports.unfollowUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const followerId = req.user.id;

    const follow = await Follow.findOneAndDelete({ follower: followerId, following: userId });

    if (!follow) {
      return res.status(404).json({ error: "Not following this user" });
    }

    res.json({
      success: true,
      message: "User unfollowed successfully"
    });
  } catch (error) {
    console.error("Unfollow error:", error);
    res.status(500).json({ error: "Failed to unfollow user" });
  }
};

// Get followers of a user
exports.getFollowers = async (req, res) => {
  try {
    const { userId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // Check if user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Get total followers count
    const totalFollowers = await Follow.countDocuments({ following: userId });

    // Get paginated followers
    const followers = await Follow.find({ following: userId })
      .populate({
        path: "follower",
        select: "name email role profileImage"
      })
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 });

    const followersData = followers.map((f) => f.follower);

    res.json({
      success: true,
      data: followersData,
      pagination: {
        total: totalFollowers,
        page,
        limit,
        pages: Math.ceil(totalFollowers / limit)
      }
    });
  } catch (error) {
    console.error("Get followers error:", error);
    res.status(500).json({ error: "Failed to fetch followers" });
  }
};

// Get users that a user is following
exports.getFollowing = async (req, res) => {
  try {
    const { userId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // Check if user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Get total following count
    const totalFollowing = await Follow.countDocuments({ follower: userId });

    // Get paginated following
    const following = await Follow.find({ follower: userId })
      .populate({
        path: "following",
        select: "name email role profileImage"
      })
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 });

    const followingData = following.map((f) => f.following);

    res.json({
      success: true,
      data: followingData,
      pagination: {
        total: totalFollowing,
        page,
        limit,
        pages: Math.ceil(totalFollowing / limit)
      }
    });
  } catch (error) {
    console.error("Get following error:", error);
    res.status(500).json({ error: "Failed to fetch following" });
  }
};

// Check if current user follows target user
exports.getFollowStatus = async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.user.id;

    // Check follow status
    const follow = await Follow.findOne({
      follower: currentUserId,
      following: userId
    });

    // Get counts
    const followerCount = await Follow.countDocuments({ following: userId });
    const followingCount = await Follow.countDocuments({ follower: userId });

    res.json({
      success: true,
      data: {
        isFollowing: !!follow,
        followerCount,
        followingCount
      }
    });
  } catch (error) {
    console.error("Get follow status error:", error);
    res.status(500).json({ error: "Failed to fetch follow status" });
  }
};

// Get follower counts for a user
exports.getFollowerCounts = async (req, res) => {
  try {
    const { userId } = req.params;

    const followers = await Follow.countDocuments({ following: userId });
    const following = await Follow.countDocuments({ follower: userId });

    res.json({
      success: true,
      data: {
        followers,
        following
      }
    });
  } catch (error) {
    console.error("Get follower counts error:", error);
    res.status(500).json({ error: "Failed to fetch counts" });
  }
};
