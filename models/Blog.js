import mongoose from "mongoose";

const blogSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    excerpt: {
      type: String,
      trim: true,
      default: "",
    },
    content: {
      type: String,
      required: true,
      default: "",
    },
    coverImage: {
      type: String,
      default: "",
    },
    category: {
      type: String,
      default: "General",
      enum: [
        "General",
        "Childcare",
        "Elderly Care",
        "Nursing Tips",
        "Health & Wellness",
        "Nutrition",
        "Company News",
      ],
    },
    tags: [
      {
        type: String,
        trim: true,
      },
    ],
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    authorName: {
      type: String,
      default: "Healthy Nara Team",
    },
    status: {
      type: String,
      enum: ["Draft", "Published", "Archived"],
      default: "Draft",
      index: true,
    },
    isFeatured: {
      type: Boolean,
      default: false,
    },
    publishedAt: {
      type: Date,
    },
    readTimeMinutes: {
      type: Number,
      default: 3,
    },
    viewCount: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

// Helper method or pre-save hook to calculate read time
blogSchema.pre("save", function () {
  if (this.content) {
    const wordCount = this.content.replace(/<[^>]*>/g, " ").trim().split(/\s+/).length;
    this.readTimeMinutes = Math.max(1, Math.ceil(wordCount / 200));
  }
  if (this.status === "Published" && !this.publishedAt) {
    this.publishedAt = new Date();
  }
});

export const Blog = mongoose.model("Blog", blogSchema);
