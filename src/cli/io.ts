/**
 * The write and read seams every CLI command shares. Command modules depend on
 * this type alone so they never import the executable entrypoint.
 */
export type CliIo = {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** Read all of stdin; injectable for tests. Used by `related --stdin`. */
  stdin?: () => string;
};
