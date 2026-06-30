class BackgroundQueue {
  private chain: Promise<void> = Promise.resolve();

  enqueue(task: () => Promise<void>): void {
    this.chain = this.chain.then(task).catch(() => undefined);
  }

  async drain(timeoutMs = 5000): Promise<void> {
    const done = this.chain;
    await Promise.race([
      done,
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  }
}

export { BackgroundQueue };
