export type Message = {
  id: string;
  senderId: string;
  body: string;
  imagePaths: string[];
  clientMsgId: string;
  createdAt: string;
};

export type OutboxItem = {
  clientMsgId: string;
  body: string;
  imagePaths: string[];
  createdAt: string;
  state: 'sending' | 'failed';
};
