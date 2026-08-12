export type CodexConversationVisualization = {
  readonly path: string;
  readonly title: string;
};

export type CodexConversationVisualizationOpenHandler = (
  visualization: CodexConversationVisualization,
) => void | Promise<void>;
