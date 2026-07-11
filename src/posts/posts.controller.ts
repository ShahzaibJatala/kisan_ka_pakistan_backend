import { Controller, Get, Post, Body, Req, UseGuards, Param, ParseIntPipe, Query } from '@nestjs/common';
import { PostsService } from './posts.service';
import { CreatePostDto } from './dto/create-post.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles/roles.decorator';
import { Role } from '@prisma/client';

@Controller('posts')
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  @Get()
  findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 10;
    return this.postsService.findAll(pageNum, limitNum);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SADAR, Role.ARTIA, Role.FARMER)
  @Post()
  create(@Body() createPostDto: CreatePostDto, @Req() req: any) {
    return this.postsService.create(createPostDto, req.user.id);
  }

  @Get('home-feed')
  getHomeFeed() {
    return this.postsService.getHomeFeed();
  }

  @Get('user/:userId')
  findByUser(@Param('userId', ParseIntPipe) userId: number) {
    return this.postsService.findByUser(userId);
  }

  @Get('user/:userId/count')
  countByUser(@Param('userId', ParseIntPipe) userId: number) {
    return this.postsService.countByUser(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/comments')
  createComment(
    @Param('id', ParseIntPipe) postId: number,
    @Body() createCommentDto: CreateCommentDto,
    @Req() req: any,
  ) {
    return this.postsService.createComment(postId, req.user.id, createCommentDto.content);
  }

  @Get(':id/comments')
  findComments(@Param('id', ParseIntPipe) postId: number) {
    return this.postsService.findCommentsByPostId(postId);
  }
}
