import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePostDto } from './dto/create-post.dto';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class PostsService {
  constructor(
    private prisma: PrismaService,
    private redisService: RedisService,
  ) {}

  async create(createPostDto: CreatePostDto, authorId: number) {
    const post = await this.prisma.post.create({
      data: { ...createPostDto, authorId },
    });

    // Invalidate caches since new post is created
    await this.redisService.del('posts:latest');
    await this.redisService.del('home:feed');

    return post;
  }

  async findAll(page: number = 1, limit: number = 10) {
    const isFirstPage = page === 1 && limit === 10;
    const cacheKey = 'posts:latest';

    if (isFirstPage) {
      const cached = await this.redisService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    }

    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.post.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          author: { select: { name: true, role: true } },
          _count: { select: { comments: true } },
        },
      }),
      this.prisma.post.count(),
    ]);

    const result = {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };

    if (isFirstPage) {
      // Cache the first page of posts for 5 minutes
      await this.redisService.set(cacheKey, JSON.stringify(result), 300);
    }

    return result;
  }

  async createComment(postId: number, authorId: number, content: string) {
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
    });
    if (!post) {
      throw new NotFoundException('Post not found');
    }

    const comment = await this.prisma.comment.create({
      data: {
        content,
        postId,
        authorId,
      },
      include: {
        author: {
          select: {
            id: true,
            name: true,
            role: true,
            profileImage: true,
          },
        },
      },
    });

    // Invalidate caches since comments count changed
    await this.redisService.del('posts:latest');
    await this.redisService.del('home:feed');

    return comment;
  }

  async findCommentsByPostId(postId: number) {
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
    });
    if (!post) {
      throw new NotFoundException('Post not found');
    }

    return this.prisma.comment.findMany({
      where: { postId },
      orderBy: { createdAt: 'asc' },
      include: {
        author: {
          select: {
            id: true,
            name: true,
            role: true,
            profileImage: true,
          },
        },
      },
    });
  }

  async findByUser(userId: number) {
    return this.prisma.post.findMany({
      where: { authorId: userId },
      orderBy: { createdAt: 'desc' },
      include: {
        author: {
          select: { id: true, name: true, role: true, profileImage: true },
        },
        _count: { select: { comments: true } },
      },
    });
  }

  async countByUser(userId: number) {
    const count = await this.prisma.post.count({
      where: { authorId: userId },
    });
    return { count };
  }

  async getHomeFeed() {
    const cacheKey = 'home:feed';
    const cached = await this.redisService.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const allPrices = await this.prisma.price.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, name: true, role: true } },
      },
    });

    const latestPricesMap = new Map<string, any>();
    for (const price of allPrices) {
      const key = price.cropId
        ? `id_${price.cropId}`
        : (price.name_en || price.name_ur || 'unknown').toLowerCase().trim();

      if (!latestPricesMap.has(key)) {
        latestPricesMap.set(key, {
          cropId: price.cropId,
          cropName: price.name_en || price.name_ur || 'Unknown',
          latestPrice: price,
        });
      }
    }

    const latestPrices = Array.from(latestPricesMap.values());

    const latestPosts = await this.prisma.post.findMany({
      take: 4,
      orderBy: { createdAt: 'desc' },
      include: {
        author: {
          select: { id: true, name: true, role: true, profileImage: true },
        },
        _count: { select: { comments: true } },
      },
    });

    const result = {
      latestPrices,
      latestPosts,
    };

    // Cache the home feed for 5 minutes
    await this.redisService.set(cacheKey, JSON.stringify(result), 300);

    return result;
  }

 
}
