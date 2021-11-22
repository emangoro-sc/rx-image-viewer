const path = require("path");
 
module.exports = {
    entry: "./src/index.ts",
    devtool: 'inline-source-map',
    output: {
        path: path.resolve(__dirname, "public"),
        filename: "index.js",
    },
    resolve: {
        extensions: [".ts", ".js", ".tsx"],
    },

    //default mode is production
    mode: "development",
    module: {
        rules: [
            {
                test: /\.js$/,
                exclude: /(node_modules)/,
                use: {
                    loader: "babel-loader",
                    options: {
                        presets: ["@babel/preset-env"],
                    },
                },
            },
            {
                test: /\.tsx?$/,
                use: "ts-loader",
                exclude: /node_modules/,
            },
            {
                test: /\.(png|jpe?g|gif|svg)$/,
                use: [
                    {
                        loader: "file-loader",
                        options: {
                            outputPath: "public/images",
                        },
                    },
                ],
            },
            {
  test:/\.html$/,
  use: [
    'html-loader'
  ]
},
        ],
    },
};
