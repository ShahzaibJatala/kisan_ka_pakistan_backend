import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePostDto } from './dto/create-post.dto';

@Injectable()
export class PostsService {
  constructor(private prisma: PrismaService) {}

  async create(createPostDto: CreatePostDto, authorId: number) {
    return this.prisma.post.create({
      data: { ...createPostDto, authorId },
    });
  }

  async findAll() {
    return this.prisma.post.findMany({
      orderBy: { createdAt: 'desc' },
      include: { 
        author: { select: { name: true, role: true } },
        _count: { select: { comments: true } }
      },
    });
  }

  async createComment(postId: number, authorId: number, content: string) {
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
    });
    if (!post) {
      throw new NotFoundException('Post not found');
    }

    return this.prisma.comment.create({
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
        author: { select: { id: true, name: true, role: true, profileImage: true } },
        _count: { select: { comments: true } }
      }
    });
  }

  async countByUser(userId: number) {
    const count = await this.prisma.post.count({
      where: { authorId: userId }
    });
    return { count };
  }

  async getHomeFeed() {
    const allPrices = await this.prisma.price.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, name: true, role: true } }
      }
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
          latestPrice: price
        });
      }
    }

    const latestPrices = Array.from(latestPricesMap.values());

    const latestPosts = await this.prisma.post.findMany({
      take: 4,
      orderBy: { createdAt: 'desc' },
      include: {
        author: { select: { id: true, name: true, role: true, profileImage: true } },
        _count: { select: { comments: true } }
      }
    });

    return {
      latestPrices,
      latestPosts
    };
  }
}
