// The home page is served here, at "/", with a 200. It used to be a 308 to
// /landing while /landing declared "/" as its canonical, so the two strongest
// signals Google has disagreed about which URL is the home page: the redirect
// said /landing, the canonical said "/". Search Console listed "/" as "Page
// with redirect" and the brand query landed on whichever it picked that week.
//
// /landing keeps answering 200 with the same page and canonical "/" rather
// than redirecting here. Browsers cached the old permanent redirect from "/"
// to /landing (it carried no Cache-Control), and a redirect back the other
// way would loop for every one of them until that cache entry is evicted.
export { default, metadata } from "./landing/page";
