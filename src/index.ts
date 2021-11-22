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
    ChangeCategory = "changeCategory",
}

const nextButtonElement = document.getElementById("next");
const backButtonElement = document.getElementById("back");
const categorySelectElement = document.getElementById("category") as HTMLSelectElement | null;
const currentImageElement = document.getElementById("img") as HTMLImageElement | null;
const loadingImageElement = document.getElementById("loading") as HTMLImageElement | null;
const counterElement = document.getElementById("counter");

if (!nextButtonElement || !backButtonElement || !categorySelectElement || !currentImageElement || !loadingImageElement || !counterElement) {
    console.error("Found Dom elements:", {
        nextButtonElement,
        backButtonElement,
        subSelectElement: categorySelectElement,
        currentImageElement,
        loadingImageElement,
        counterElement,
    });
    throw Error("Could not find some required dom elements");
}

const FALLBACK_IMAGE_URL = "/images/error.png";

/** Utility to fire a request to a "server" to get the list of image urls in the current category */
function getCategoryImageUrlsWithPotentialErrors(categoryName: string): Observable<string[]> {
    const categoryImagesRequestEndpoint = `/categories/${categoryName}.json`;

    // defer ensure new Observable (and therefore) promise gets created for each subscription
    // rather than sharing the same promise between subscriptions. This ensures functions like retry will issue additional requests.
    return defer(() =>
        new Observable<string[]>((subscriber) => {
            if (Math.random() > 0.8) {
                const artificialError = "Artificial getCategoryImageUrls error"
                console.warn(artificialError)
                subscriber.error(artificialError);
            } else {
                fetch(categoryImagesRequestEndpoint, {
                    method: "GET",
                    headers: {
                        // "Content-Type": "application/json",
                    },
                })
                    .then((res) => res.json())
                    .then((data) => {
                        console.log({ categoryImageUrls: data });
                        const loadedImageUrls: string[] = data;
                        sessionStorage.setItem(categoryName, JSON.stringify(loadedImageUrls)); // local cache
                        console.log({ loadedImageUrls });
                        subscriber.next(loadedImageUrls);
                    })
                    .catch((errorReason) => {
                        subscriber.error(`getCategoryImageUrls error: ${errorReason}`);
                    });
            }
        }).pipe(
            // cache in session storage
            tap((loadedImageUrls) => sessionStorage.setItem(categoryName, JSON.stringify(loadedImageUrls))),
        ),
    );
}

const generalKeyEvent$ = fromEvent<KeyboardEvent>(document, "keyup").pipe(
    filter((event) => event.target !== categorySelectElement), 
);

// user action streams
const backClick$ = fromEvent(backButtonElement, "click").pipe(share());
const rightArrowPress$ = generalKeyEvent$.pipe(filter((event) => event.code === KeyCodes.RIGHT));
const leftArrowPress$ = generalKeyEvent$.pipe(filter((event) => event.code === KeyCodes.LEFT));
const upArrowPress$ = generalKeyEvent$.pipe(filter((event) => event.code === KeyCodes.UP));
const downArrowPress$ = generalKeyEvent$.pipe(filter((event) => event.code === KeyCodes.DOWN));
const nextClick$ = fromEvent(nextButtonElement, "click").pipe(share());
const subChange$ = fromEvent(categorySelectElement, "change").pipe(share());
const categoryKeyboardChange$ = fromEvent(categorySelectElement, "keyup").pipe(tap((e) => e.preventDefault()));
 
const categoryChange$ = concat(
    of(categorySelectElement.value), // to load initial category
    subChange$.pipe(map((e) => (e.target! as HTMLSelectElement).value)),
).pipe(
    tap((subNameChangeValue) => console.log({ subNameChangeValue })),
    switchMap((newCategory: string) => {
        return getCategoryImageUrlsWithPotentialErrors(newCategory).pipe(
            retry(3),
            map((imageUrls) => {
                if (!imageUrls.length) {
                    throw Error(`No image urls loaded for ${newCategory}`);
                }
                return { name: newCategory, imageUrls };
            }),
        );
    }),
);

const LOADING_TIMEOUT_MS = 200;

/** Util to create an image loading observable */
const loadImageElementUrlWithPossibleErrors = (imgElement: HTMLImageElement, url: string) => {
    return new Observable<string>((observer) => {
        if (Math.random() > 0.5) {
            const artificialError = "Artificial preload error";
            console.warn(artificialError);
            observer.error(artificialError);
        } else {
            imgElement.onerror = (event) => observer.error({ url, event });
            imgElement.onload = function () {
                console.log("image pre-loaded", { url });

                const artificialLoadingDurationMs = Math.random() * LOADING_TIMEOUT_MS * 4; // intentionally large so timeout functionality is used
                setTimeout(() => observer.next(url), artificialLoadingDurationMs);
                // ! dont call observer.complete() as this unsubscribes and removes image even if it was successful
            };

            // start image pre-loading
            imgElement.src = url;
        }

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
const preloadImageUrlOrFallback = (url: string) => {
    return loadImageElementUrlWithPossibleErrors(new Image(), url).pipe(
        // set the timeout for the process
        timeout({ first: LOADING_TIMEOUT_MS }),
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
    categoryChange$.pipe(map(() => UserAction.ChangeCategory)),
).pipe(tap((navigationActionCode) => console.log({ navigationActionCode })));

type CategoryData = {
    name: string;
    imageUrls: string[];
};

const START_INDEX = 0;

/** Stream of image changes, gets the latest value of each stream */
const currentImageChange$ = combineLatest([userActionCode$, categoryChange$]).pipe(
    // equivalent to reduce for arrays
    scan(
        (currentAccumulatedState, newIncomingState, eventIndex) => {
            const [actionCode, newCategory] = newIncomingState;
            const { index: oldIndex, categoryData: oldCategoryData } = currentAccumulatedState;

            const getNewBoundedIndex = () => {
                const delta = actionCode === UserAction.Next ? 1 : -1;
                const newIndex = oldIndex + delta;
                return Math.min(Math.max(newIndex, START_INDEX), newCategory.imageUrls.length - 1);
            };

            // new index, if it is 0 then this means go to initial index
            const newIndex = actionCode === UserAction.ChangeCategory ? START_INDEX : getNewBoundedIndex();

            console.log({ eventIndex, newIncomingState, currentAccumulatedState, newIndex });

            return {
                index: newIndex,
                categoryData: newCategory,
                indexChanged: oldIndex !== newIndex,
                categoryChanged: oldCategoryData?.name !== newCategory.name,
            };
        },
        { index: START_INDEX } as {
            index: number;
            categoryData: CategoryData;
            indexChanged: boolean;
            categoryChanged: boolean;
        },
    ),
    // filter out events that don't change anything
    filter(({ indexChanged, categoryChanged, categoryData }) => {
        return indexChanged || categoryChanged;
    }),
    // show loader and update counter when there is definitely a change incoming
    tap(({ index, categoryData }) => {
        counterElement.innerText = `${index}/${categoryData?.imageUrls.length - 1}`;
        loadingImageElement.style.visibility = "visible";
        // dont show an image when loading a new one
        currentImageElement.src = "";
    }),

    // switch to latest image if there are changes
    switchMap(({ index, categoryData }) => {
        const currentImageToLoad = categoryData.imageUrls[index];
        // preload image url in a dummy img element
        return preloadImageUrlOrFallback(currentImageToLoad).pipe(
            // data format to send to subscriber about change
            map((imageUrl) => ({
                index,
                categoryData,
                currentImageUrl: imageUrl,
            })),
        );
    }),
    // apply new image
    tap(({ currentImageUrl, categoryData, index }) => {
        currentImageElement.src = currentImageUrl;
        currentImageElement.alt = `${categoryData.name}-${index}`;
        loadingImageElement.style.visibility = "hidden";
    }),
    // make sure fallback is set even if another error occurs
    catchError((e) => {
        currentImageElement.src = FALLBACK_IMAGE_URL;
        throw Error(`An unhandled error with the observable pipeline occurred: ${e}`);
    }),
);

console.log("before subscribe");
const subscription = currentImageChange$.subscribe({
    next(imageChangeData) {
        console.log("image changed", { imageChangeData });
        console.log("-".repeat(100));
    },
    error(error) {
        console.error("image change error", { error });
        console.log("-".repeat(100));
    },
    complete() {
        console.error("completed");
        console.log("-".repeat(100));
    },
});
