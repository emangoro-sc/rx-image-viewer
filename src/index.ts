import { catchError, combineLatest, concat, defer, filter, finalize, fromEvent, map, merge, Observable, of, retry, scan, share, switchMap, tap, timeout } from "rxjs";

enum KeyCodes {
    LEFT = "ArrowLeft",
    UP = "ArrowUp",
    RIGHT = "ArrowRight",
    DOWN = "ArrowDown",
}

enum UserAction {
    Next = "next",
    Previous = "previous",
    ChangeSub = "changeSub",
}

const nextButtonElement = document.getElementById("next");
const backButtonElement = document.getElementById("back");
const subSelectElement = document.getElementById("sub") as HTMLSelectElement;
const currentImageElement = document.getElementById("img") as HTMLImageElement;
const loadingImageElement = document.getElementById("loading") as HTMLImageElement;
const counterElement = document.getElementById("counter");

if (!nextButtonElement || !backButtonElement || !subSelectElement || !currentImageElement || !loadingImageElement || !counterElement) {
    console.error("Found Dom elements:", {
        nextButtonElement,
        backButtonElement,
        subSelectElement,
        currentImageElement,
        loadingImageElement,
        counterElement,
    });
    throw Error("Could not find some required dom elements");
}

const FALLBACK_IMAGE_URL = "/images/error.png";

// const Observable = Rx.Observable;
// debugger;
// debugger;
// function which returns an array of image URLs for a given reddit sub
// getSubImages("pics") ->
// [
//   "https://upload.wikimedia.org/wikipedia/commons/3/36/Hopetoun_falls.jpg",
//   "https://upload.wikimedia.org/wikipedia/commons/3/38/4-Nature-Wallpapers-2014-1_ukaavUI.jpg",
//   ...
// ]
function getSubImages(sub: string): Observable<string[]> {
    const cachedImageUrls = JSON.parse(sessionStorage.getItem(sub) || "[]") as string[];
    if (cachedImageUrls.length) {
        console.log({ cachedImageUrls });
        return of(cachedImageUrls);
    } else {
        const subImagesRequestEndpoint = `https://www.reddit.com/r/${sub}/.json?limit=200&show=all`;

        // defer ensure new Observable (and therefore) promise gets created for each subscription
        // rather than sharing the same promise between subscriptions. This ensures functions like retry will issue additional requests.
        return defer(() =>
            new Observable<string[]>(({ next, error }) => {
                fetch(subImagesRequestEndpoint, {
                    method: "GET",
                    headers: {
                        // "Content-Type": "application/json",
                    },
                })
                    .then((res) => res.json())
                    .then((data) => {
                        console.log({ subData: data });
                        const loadedImageUrls: string[] = data.data.children.map((image: any) => image.data.url);
                        sessionStorage.setItem(sub, JSON.stringify(loadedImageUrls)); // local cache
                        console.log({ loadedImageUrls });
                        next(loadedImageUrls);
                    })
                    .catch((e) => {
                        debugger;
                        error(e);
                    });
            }).pipe(
                // cache in session storage
                tap((loadedImageUrls) => sessionStorage.setItem(sub, JSON.stringify(loadedImageUrls))),
            ),
        );
    }
}

const keyEvent$ = fromEvent<KeyboardEvent>(document, "keyup");

// user action streams
const backClick$ = fromEvent(backButtonElement, "click").pipe(share());
const rightArrowPress$ = keyEvent$.pipe(filter((event) => event.code === KeyCodes.RIGHT));
const leftArrowPress$ = keyEvent$.pipe(filter((event) => event.code === KeyCodes.LEFT));
const upArrowPress$ = keyEvent$.pipe(filter((event) => event.code === KeyCodes.UP));
const downArrowPress$ = keyEvent$.pipe(filter((event) => event.code === KeyCodes.DOWN));
const nextClick$ = fromEvent(nextButtonElement, "click").pipe(share());
const subChange$ = fromEvent(subSelectElement, "change").pipe(share());
const subNameChange$ = concat(
    of(subSelectElement.value), // initial sub
    subChange$.pipe(map((e) => (e.target! as HTMLSelectElement).value)),
).pipe(tap((subNameChangeValue) => console.log({ subNameChangeValue })));

/** Util to create an image loading observable */
const loadImageElementUrl = (imgElement: HTMLImageElement, url: string ) => {
    return new Observable<string>((observer) => {
        imgElement.onerror = (event) => observer.error({ url, event });
        imgElement.onload = function () {
            console.log("image pre-loaded", { url });
            observer.next(url);
            // ! dont call observer.complete() as this unsubscribes and removes image even if it was successful
        };

        // start image pre-loading
        imgElement.src = url;

        const unsubscriber = () => {
            // removes listeners
            imgElement.onerror = null;
            imgElement.onload = null;
            // stops image loading in process
            imgElement.src = "";
        };
        return unsubscriber;
    });
};

// preload url using dummy image element
const preloadImageUrlOrFallback = (url: string ) => {
    return loadImageElementUrl(new Image(), url ).pipe(
        timeout({ first: 500 }),
        // retry twice before actually throwing if loading failed
        retry(2),
        // use fallback if it really failed to load
        catchError((error) => {
            console.error("preloadImageUrlOrFallback", error);
            return of(FALLBACK_IMAGE_URL);
        }),
    );
};

// observable that notifies whenever a user performs an action,
// like changing the sub or navigating the images
/** Stream of image user actions mapped to codes */
const userActionCode$ = merge(
    merge(backClick$, leftArrowPress$).pipe(map(() => UserAction.Previous)),
    merge(nextClick$, rightArrowPress$).pipe(map(() => UserAction.Next)),
    subNameChange$.pipe(map(() => UserAction.ChangeSub)),
).pipe(tap((navigationActionCode) => console.log({ navigationActionCode })));

/** API call to get image url array */
const imageListLoad$ = subNameChange$.pipe(
    tap((imageListLoadSub) => console.log({ imageListLoadSub })),
    // if getting the images fails, retries up to 3 times before actually throwing
    switchMap((sub: string) => getSubImages(sub).pipe(retry(3))),
);

const START_INDEX = 0;

/** Stream of image changes, gets the latest value of each stream */
const currentImageChange$ = combineLatest([userActionCode$, imageListLoad$, subNameChange$]).pipe(
    // equivalent to reduce for arrays
    scan(
        (currentAccumulatedState, newIncomingState) => {
            const [actionCode, newImageUrls, newSub] = newIncomingState;
            const { index: oldIndex, sub: oldSub } = currentAccumulatedState;

            const getNewBoundedIndex = () => {
                const delta = actionCode === UserAction.Next ? 1 : -1;
                const newIndex = oldIndex + delta;
                return Math.min(Math.max(newIndex, START_INDEX), newImageUrls.length - 1);
            };

            // new index, if it is 0 then this means go to initial index
            const newIndex = actionCode === UserAction.ChangeSub ? START_INDEX : getNewBoundedIndex();

            return {
                index: newIndex,
                sub: newSub,
                images: [...newImageUrls],
                indexChanged: oldIndex !== newIndex,
                subChanged: oldSub !== newSub,
            };
        },
        { index: START_INDEX } as {
            index: number;
            images: string[];
            sub: string;
            indexChanged: boolean;
            subChanged: boolean;
        },
    ),
    // filter out events that don't change anything
    filter(({ indexChanged, subChanged }) => indexChanged || subChanged),
    // show loader and update counter when there is definitely a change incoming
    tap(({ index, images, subChanged }) => {
        counterElement.innerText = `${index + 1}/${images.length}`;
        loadingImageElement.style.visibility = "visible";
        // dont show an image when loading a new one
        currentImageElement.src = "";
    }),
    // switch to latest image if there are changes
    switchMap(({ index, images, sub }) => {
        const currentImageToLoad = images[index];
        // preload image url in a dummy img element
        return preloadImageUrlOrFallback(currentImageToLoad, ).pipe(
            // then load the preloaded url (or fallback url if fa) into actual current image element
            // switchMap((preloadedImgUrl) => loadImageElementUrl(currentImageElement, preloadedImgUrl)),

            // data format to send to subscriber about change
            map((imageUrl) => ({
                index,
                images,
                sub,
                currentImageUrl: imageUrl,
            })),
        );
    }),
    // apply new image
    tap(({ currentImageUrl, sub, index }) => {
        currentImageElement.src = currentImageUrl;
        currentImageElement.alt = `${sub}-${index}`
        loadingImageElement.style.visibility = "hidden";
    }),
    // make sure fallback is set even if another error occurs
    catchError((e) => {
        currentImageElement.src = FALLBACK_IMAGE_URL;
        throw Error(`An error ocurred outside of image loading: ${e}`);
    }),
);

console.log("before subscribe");
const subscription = currentImageChange$.subscribe({
    next(imageChangeData) {
        console.log("image changed", { imageChangeData });
    },
    error(error) {
        console.error("image change error", { error });
    },
});
