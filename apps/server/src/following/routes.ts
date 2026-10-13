import type { FastifyInstance } from 'fastify';
import type { FollowingService } from './service.ts';
import { ValidationError } from '../http/validation.ts';
export function registerFollowingRoutes(app: FastifyInstance, service: FollowingService): void {
  app.get<{Params:{accountId:string};Querystring:{q?:string}}>('/api/accounts/:accountId/following', async req => {
    if (req.query.q !== undefined && (typeof req.query.q !== 'string' || req.query.q.length > 200)) throw new ValidationError('搜索内容最多 200 字');
    return {ok:true,data:service.list(req.params.accountId,req.query.q)};
  });
  app.post<{Params:{accountId:string};Body:{username?:unknown}}>('/api/accounts/:accountId/following', async req => {
    if (typeof req.body?.username !== 'string' || !/^@?[A-Za-z0-9_]{1,15}$/.test(req.body.username.trim())) throw new ValidationError('请填写 X 用户名');
    return {ok:true,data:await service.add(req.params.accountId,req.body.username.trim())};
  });
  app.post<{Params:{accountId:string;id:string}}>('/api/accounts/:accountId/following/:id/unfollow', async req => ({ok:true,data:await service.unfollow(req.params.accountId,req.params.id)}));
  app.post<{Params:{accountId:string;id:string}}>('/api/accounts/:accountId/following/:id/refresh', async req => ({ok:true,data:await service.refresh(req.params.accountId,req.params.id)}));
  app.post<{Params:{accountId:string;id:string}}>('/api/accounts/:accountId/following/:id/summary', async req => {
    service.enqueue(req.params.accountId,req.params.id,{manual:true}); return {ok:true,data:{queued:true}};
  });
  app.put<{Params:{accountId:string;id:string};Body:{text?:unknown}}>('/api/accounts/:accountId/following/:id/summary', async req => {
    if (typeof req.body?.text !== 'string') throw new ValidationError('画像必须是文本');
    return {ok:true,data:service.editSummary(req.params.accountId,req.params.id,req.body.text)};
  });
}
